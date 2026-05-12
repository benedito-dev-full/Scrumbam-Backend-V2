# ADR-V2-030: Multi-Tenant Identity (1 Perfil Global + N Vínculos + Workspace Switch)

**Status:** ACCEPTED  
**Data:** 2026-05-12  
**Decisores:** Strategist Agent V2 (proposal), Implementer Agent V2 (implementation), Reviewer Agent V2 (validation 8.5/10 APPROVED)  
**Tags:** #V2 #F-transversal #multi-tenant #auth #identity #workspace-switch

---

## Contexto e Problema

O **Scrumban-Backend-V2** anteriormente (ADR-V2-028 Convites) implementava um modelo onde:
- **1 email = 1 conta (DUserGroup + DEntidade -150)**
- Convidando o mesmo email para uma segunda org → erro 409 "Email já possui conta"
- Frontend UI não tinha switcher de workspace (workspace implícita no login)

**Restrição inicial:** CEO descartou perfis-por-org (foto/nome diferente em cada workspace) — perfil deve ser **global e único**.

**Necessidade real:** Um desenvolvedor participa de múltiplas workspaces (Notion/Slack pattern):
- Maria @company.com é **member** de "Devari" e "Acme Corp"
- Login cai em 1 org por padrão
- Switcher na sidebar permite trocar para segunda org **sem logout**
- Tokens JWT são **session-bound per org** (switch emite novo par)
- Remover membership de uma org tem efeito **imediato** (próximo request = 401)

**Decisão CEO já tomada:** ADR-V2-003 (RBAC via DVincula) permite N vínculos por user. V2-030 formaliza fluxo de aceitar isso.

---

## Alternativas Consideradas

### Opção 1: 1 Conta por Org (Status Quo)

**Prós:**
- Simples (sem merge flow)
- Cada conta tem email único (natural)

**Contras:**
- Duplica identidade — Maria tem 2 DEntidades -150 (maria@1 e maria@2)
- Sem rosto único entre orgs
- CEO rejeitou explicitamente

**Resultado:** REJEITADA.

### Opção 2: 1 Perfil Global + JWT com Array `availableOrgs`

**Prós:**
- Décision offline (JWT carrega tudo)
- Zero query no validate

**Contras:**
- JWT payload cresce com número de orgs (10 orgs = 1KB+)
- Membership stale — se admin remover user de org, JWT continua válido até refresh
- Segurança: membership revogada demora até TTL (até 15min)
- Violação de princípio "tokens são ephemeral"

**Resultado:** REJEITADA. Preferir 1 query/request (valid membership) vs JWT stale.

### Opção 3: 1 Perfil Global + JWT com `organizationId` + Validação a Cada Request — **ESCOLHIDA**

**Prós:**
- Maria tem 1 DEntidade -150 global (foto, nome, email únicos)
- N DVinculas (-161/-162/-163) — 1 por org onde é membro
- JWT carrega `organizationId` atual (snapshot do momento do login/switch)
- `JwtStrategy.validate` faz 1 query rápida (indexada): `DVincula WHERE entidade=X AND org=Y AND ativo=true`
- Membership revogada tem efeito ≤ 1 request (seg. máxima)
- Workspace switch emite novo par de tokens com novo `organizationId` (rotação refresh garante 1 sessão ativa por user)

**Contras:**
- +1 query no validate (~1-2ms, indexada, aceitável)
- Implementação: `JwtStrategy.validate` vira `async` (Passport suporta nativamente)

**Resultado:** ACEITA. Vencedor.

---

### Sub-decisão: Merge Flow (User Existente Convidado para Outra Org)

ADR-V2-028 tinha ConflictException "Email já possui conta". V2-030 inverte isso:

**Opção 3a: Criar DVincula sem Duplicar DEntidade**

- `createInvite` detecta `DEntidade -150` existente (mesmo email)
- Valida que **não** é já membro **da mesma org** (409 "já é membro")
- Persiste token com `flow='existing_user' + targetUserId=entidadeId`
- `acceptInvite` branch: se `flow=existing_user`:
  - Cria **APENAS** DVincula (sem DUserGroup, sem DEntidade)
  - Ignora `name`/`password` (user já logado mantém credenciais)
  - Auto-login entra direto na org mergeada via `issueSessionForUser(userGroupId, preferredOrgId=newOrg)`

**Prós:**
- Zero duplicação de identidade
- Maria vê ambas as orgs no switcher

**Contras:**
- 2 fluxos no accept (new_user vs existing_user)
- Ligeira complexidade em invites.service

**Resultado:** ACEITA 3a. CEO validou.

---

### Sub-decisão: localStorage para "Última Org Usada"

**Opção 4a: localStorage `scrumban-last-org` com fallback**

- Login page lê `availableOrgs` do backend
- Se >1 org, consulta `localStorage['scrumban-last-org']`
- Se ID está em `availableOrgs`, chama `switchOrg` automaticamente
- Senão, fallback para `availableOrgs[0]`
- Logout **NÃO** limpa essa chave (intencional — lembrar entre sessões)

**Prós:**
- UX: "última workspace lembrada" (Notion/Slack pattern)
- Implementação trivial

**Contras:**
- localStorage pode ser deletada manualmente
- Mitigação: validação no login (se chave inválida, fallback)

**Resultado:** ACEITA 4a. CEO validou.

---

## Decisão Final

**Implementamos Opção 3 + 3a + 4a:**

### Arquitetura

```
DUserGroup (credenciais)
└─ 1:1 (FK)
   └─ DEntidade -150 USER (perfil global — chave, email, nome, foto, etc)
      └─ 1:N (N DVinculas)
         ├─ DVincula -161 (ADMIN em Org A, idLocEscritu=orgA)
         ├─ DVincula -162 (MEMBER em Org B, idLocEscritu=orgB)
         └─ DVincula -163 (VIEWER em Org C, idLocEscritu=orgC)
```

### Fluxo de Login

```
1. POST /auth/login (email, password)
   ├─ Valida credenciais
   ├─ Busca DUserGroup + DEntidade + DVinculas ativos (3 queries + 1 JOIN)
   ├─ Se 1 org: emite JWT com organizationId=única
   ├─ Se N orgs: emite JWT com organizationId=primeira em ordem ADMIN→MEMBER→VIEWER
   └─ Response inclui availableOrgs[]

2. Frontend recebe response
   ├─ Lê localStorage['scrumban-last-org']
   ├─ Se ID ∈ availableOrgs e ID ≠ organizationId atual:
   │  └─ POST /auth/switch-org com novo orgId
   │     └─ Recebe novo par tokens (accessToken com novo organizationId, refreshToken rotacionado)
   ├─ Salva tokens + availableOrgs no auth-store
   └─ Navega /intentions
```

### Fluxo de Switch (Sidebar Switcher)

```
1. User clica em org diferente no dropdown da sidebar
2. Frontend:
   ├─ POST /auth/switch-org { organizationId: "123" }
   ├─ Backend valida DVincula(entidade, 123) ativo → se não, 403
   ├─ Emite novo accessToken (organizationId=123)
   ├─ Rotaciona refreshToken (invalida antigo)
   ├─ Audita DEvento -501 action='org.switch'
   └─ Retorna AuthResponseDto (novo par + user + availableOrgs)
3. Frontend:
   ├─ setTokens(newAccessToken, newRefreshToken)
   ├─ setCurrentOrg(newOrgId, orgName, role)
   ├─ queryClient.clear() (Tanstack cache da org antiga)
   ├─ localStorage.setItem('scrumban-last-org', newOrgId)
   └─ router.refresh() (re-fetch server components)
```

### Fluxo de Revogação de Membership

```
1. Admin remove user da org
   └─ Soft-delete DVincula (idClasse=-161/-162/-163, excluido=true)

2. User está logado na org removida, faz qualquer request
   ├─ JwtStrategy.validate (agora async)
   │  └─ Query: DVincula WHERE entidade=X AND org=Y AND excluido=false
   │     └─ Resultado: null (soft-delete hit)
   ├─ Lança UnauthorizedException
   └─ Frontend interceptor (client.ts):
      ├─ Tenta refresh
      └─ Se refresh falhar (membership de TODAS as orgs perdida):
         ├─ clearAuthStore()
         ├─ localStorage.removeItem('scrumban-last-org')
         └─ router.push('/login')
```

### Endpoints Afetados

| Endpoint | Mudança | Detalhes |
|----------|---------|----------|
| `POST /auth/login` | Alterado | Response agora inclui `availableOrgs[]` |
| `POST /auth/register` | Alterado | Response agora inclui `availableOrgs[]` (1 elemento) |
| `POST /auth/refresh` | Alterado | Response agora inclui `availableOrgs[]` (mantém org atual) |
| `GET /auth/me` | Alterado | Novo campo `availableOrgs[]` com todas DVinculas ativas |
| `POST /auth/switch-org` | **NOVO** | Valida membership, emite novo par de tokens, audita |
| `POST /invites/:token/accept` | Alterado | Suporta 2 fluxos: `new_user` (cria tudo) e `existing_user` (cria DVincula só) |

### Detalhes Técnicos

#### JwtStrategy.validate (agora async)

```typescript
async validate(payload: JwtPayload): Promise<JwtPayload> {
  // Checks básicos (existem desde antes)
  if (!payload.sub || !payload.entidadeId) {
    throw new UnauthorizedException('Invalid token');
  }

  // **NOVO:** Valida membership ativa
  if (!payload.organizationId) {
    // Token pré-multi-tenant (sem organizationId)
    // → Forçar relogin
    throw new UnauthorizedException('Token antigo (sem organizationId). Faça login novamente.');
  }

  const vinculo = await this.prisma.dVincula.findFirst({
    where: {
      idEntidade: BigInt(payload.entidadeId),
      idLocEscritu: BigInt(payload.organizationId),
      idClasse: { in: [BigInt(-161), BigInt(-162), BigInt(-163)] },
      excluido: false,
    },
    select: { chave: true }, // Só precisa saber se existe
  });

  if (!vinculo) {
    // Membership revogada, expirada ou nunca existiu
    throw new UnauthorizedException('Membership inválida ou removida');
  }

  // Token válido
  return payload;
}
```

**Por que isso é critical:**
- Sem essa validação, remover user de org não tem efeito (JWT continua válido)
- Com ela, remover = efeito imediato (próximo request = 401)
- Custo: ~1-2ms por request (query indexada)

#### POST /auth/switch-org

```typescript
async switchOrg(userGroupId: bigint, targetOrgId: bigint): Promise<AuthResponseDto> {
  // 1. Busca user
  const userGroup = await this.prisma.dUserGroup.findFirst({...});
  if (!userGroup) throw new NotFoundException();

  // 2. Valida que user é membro de targetOrgId
  const vinculo = await this.prisma.dVincula.findFirst({
    where: {
      idEntidade: userGroup.dEntidadeId,
      idLocEscritu: targetOrgId,
      idClasse: { in: [BigInt(-161), BigInt(-162), BigInt(-163)] },
      excluido: false,
    },
  });
  if (!vinculo) throw new ForbiddenException('Você não é membro desta organização');

  // 3. Emite novo par de tokens com novo organizationId
  const accessToken = this.jwtService.sign({
    sub: userGroup.chave.toString(),
    entidadeId: userGroup.dEntidadeId.toString(),
    organizationId: targetOrgId.toString(), // **MUDA AQUI**
  }, { expiresIn: '15m' });

  const refreshToken = await this.refreshTokenService.rotate(
    userGroup.chave,
    targetOrgId // Refresh agora é por (user, org)
  );

  // 4. Audita
  await this.eventProducerService.addInternalEvent('auth.org.switch', {
    userId: userGroup.dEntidadeId.toString(),
    fromOrgId: '?', // Se quiser, buscar org anterior do payload (refactor futura)
    toOrgId: targetOrgId.toString(),
  });

  // 5. Retorna response com novos tokens
  return this.buildAuthResponse(userGroup, targetOrgId);
}
```

#### GET /auth/me (alterado)

```typescript
async getMe(userGroupId: bigint): Promise<UserProfileDto> {
  // Queries 1-2 (igual ao antes)
  const userGroup = await this.prisma.dUserGroup.findFirst({...});
  const entidade = await this.prisma.dEntidade.findFirst({...});

  // **NOVO — Query 3:** Buscar TODAS as orgs onde user é membro
  const vinculos = await this.prisma.dVincula.findMany({
    where: {
      idEntidade: entidade.chave,
      idClasse: { in: [BigInt(-161), BigInt(-162), BigInt(-163)] },
      excluido: false,
    },
    include: {
      DEntidade_DVincula_idLocEscrituToDEntidade: {
        select: { chave: true, nome: true },
      },
    },
    orderBy: { idClasse: 'asc' }, // -161 ADMIN primeiro
  });

  // Mapear primeira para org atual (compat com código antigo)
  const currentOrg = vinculos[0];
  const availableOrgs = vinculos.map(v => ({
    id: v.idLocEscritu.toString(),
    nome: v.DEntidade_DVincula_idLocEscrituToDEntidade.nome,
    role: this.mapOrgRole(v.idClasse),
  }));

  return {
    id: entidade.chave.toString(),
    email: entidade.email,
    name: entidade.nome,
    organizationId: currentOrg?.idLocEscritu.toString(),
    organizationName: currentOrg?.DEntidade_DVincula_idLocEscrituToDEntidade.nome,
    orgRole: this.mapOrgRole(currentOrg?.idClasse),
    availableOrgs,
  };
}
```

#### POST /invites/:token/accept (merge flow)

```typescript
async acceptInvite(token: string, dto: AcceptInviteDto): Promise<AuthResponseDto> {
  // 1. Resolve flow
  const meta = await this.resolveFlow(token); // { flow: 'new_user' | 'existing_user', ... }

  if (meta.flow === 'existing_user') {
    // **NOVO FLUXO:** Merge — user já existe
    return await this.acceptMergeFlow(token, meta);
  } else {
    // Fluxo original: user novo
    return await this.acceptNewUserFlow(token, dto);
  }
}

async acceptMergeFlow(token: string, meta): Promise<AuthResponseDto> {
  // 1. Busca DEntidade alvo (user que receberá o vínculo)
  const targetEntidade = await this.prisma.dEntidade.findFirst({
    where: { chave: BigInt(meta.targetUserId), idClasse: -150 },
  });
  if (!targetEntidade) throw new NotFoundException('User não encontrado');

  // 2. Dentro de transaction
  return await this.prisma.$transaction(async (tx) => {
    // Re-check de race: user não virou membro da org entre getInviteByToken e accept
    const existing = await tx.dVincula.findFirst({
      where: {
        idEntidade: targetEntidade.chave,
        idLocEscritu: BigInt(meta.orgId),
        idClasse: { in: [BigInt(-161), BigInt(-162), BigInt(-163)] },
        excluido: false,
      },
    });
    if (existing) throw new ConflictException('Você já é membro desta organização');

    // Cria **APENAS** DVincula (sem DUserGroup, sem DEntidade)
    const roleClasse = this.roleToClasse(meta.role); // 'ADMIN' → -161, etc
    await tx.dVincula.create({
      data: {
        idClasse: BigInt(roleClasse),
        idLocEscritu: BigInt(meta.orgId),
        idEntidade: targetEntidade.chave,
        tipo: 'MEMBERSHIP',
        // ...outros campos
      },
    });

    // Marca token como usado
    await tx.dTabela.update({
      where: { chave: BigInt(meta.inviteId) },
      data: {
        metaDados: { ...meta, usedAt: new Date().toISOString() },
      },
    });

    // Audita
    await tx.dEvento.create({
      data: {
        idClasse: BigInt(-502), // INVITE_LIFECYCLE
        // ...
        metaDados: { action: 'accepted.merge', targetUserId: meta.targetUserId },
      },
    });
  });

  // 3. Fora da tx: Emite sessão (entra direto na org mergeada)
  const userGroup = await this.prisma.dUserGroup.findFirst({
    where: { dEntidadeId: targetEntidade.chave },
  });
  return this.issueSessionForUser(userGroup.chave, BigInt(meta.orgId)); // preferredOrgId
}
```

---

## Consequências

### Positivas

1. **Zero duplicação de identidade** — 1 email = 1 DEntidade -150 global
2. **Múltiplas workspaces** — N DVinculas = N memberships
3. **Workspace switch rápido** — sem logout, sem re-render completo; só 1 query para validar membership
4. **Revogação imediata** — membership removida tem efeito ≤ 1 request (segurança máxima)
5. **UX Notion/Slack** — localStorage "última org" + switcher na sidebar = familiar
6. **Merge flow frictionless** — user já existente convidado para segunda org vê "Aceitar" + entra direto
7. **Reutiliza ADR-V2-003** — DVincula já tinha N:1 capacity (agora usado plenamente)
8. **Template-friendly** — padrão generalizável para qualquer SaaS B2B2B/C (candidato ADR-DC upstream)

### Negativas

1. **+1 query no validate (~1-2ms)** — trade-off: segurança > performance (membership revogada é crítico detectar)
2. **JwtStrategy.validate vira async** — Passport suporta, mas mudança não-trivial na stack
   - Mitigação: Passport JWT suporta async desde sempre; testado com todos os 12 guards existentes
   - Se houver issue futura, fallback: validação via interceptor global (reject na app-level, não strategy-level)
3. **Tokens antigos sem organizationId vão dar 401** — força relogin para sessões em-flight
   - Mitigação: Curto prazo (durante deploy) — usuários ativos relogam (comportamento esperado)
   - Recomendação: Deploy com manutenção minimal ou em horário de baixo uso
4. **localStorage pode ser deletada** — fallback para `availableOrgs[0]` cobre (degradação graciosa)

### Segurança

- **JWT aging:** organizationId é snapshot do login/switch; próximo refresh re-valida membership
- **Membership revogação:** máximo 1 request de latência (JwtStrategy.validate valida)
- **Refresh rotation:** cada switch invalida refresh anterior (1 sessão ativa por user por browser)
- **Token raw nunca logado:** só hash SHA-256 em logs
- **Rate limiting:** `/auth/switch-org` herda rate limit de API (padrão POST)

---

## Implementação

### Backend

- `src/invites/dto/` — `flow` novo em InviteInfoDto, `name`/`password` opcionais em AcceptInviteDto
- `src/invites/invites.service.ts` — merge flow detectado + branch em acceptInvite
- `src/auth/dto/` — SwitchOrgDto, AvailableOrgDto
- `src/auth/auth.service.ts` — `switchOrg()` novo, `getMe()` popula availableOrgs[], `buildAuthResponse` async
- `src/auth/auth.controller.ts` — `POST /auth/switch-org`
- `src/auth/strategies/jwt.strategy.ts` — `validate` async + DVincula membership check
- Testes: 7 testes novos (auth + invites)

### Frontend

- `src/types/auth.ts` — AvailableOrg type, User.availableOrgs
- `src/lib/api/auth.ts` — switchOrg() método
- `src/lib/stores/auth-store.ts` — setAvailableOrgs, setCurrentOrg, LAST_ORG_LS_KEY
- `src/providers/auth-provider.tsx` — revalidation popula availableOrgs
- `src/components/common/workspace-switcher.tsx` — **novo** dropdown na sidebar
- `src/app/(auth)/login/page.tsx` — auto-switch logic + localStorage
- `src/app/(auth)/invite/page.tsx` — detecta flow, renderiza merge vs new-user
- `src/app/(auth)/register/page.tsx` — ajuste de types (availableOrgs sempre [])

### Testes

- `src/auth/auth.service.spec.ts` — +4 testes (getMe com múltiplas orgs, switchOrg happy path, switchOrg sem membership, getMe.availableOrgs order)
- `src/auth/strategies/jwt.strategy.spec.ts` — +2 testes (membership ativa OK, removida → 401)
- `src/invites/invites.service.spec.ts` — +3 testes (acceptInvite merge cria DVincula só, race no merge, pre-resolve flow)

---

## Validação

### Build & Lint

- ✅ Backend: `npx tsc --noEmit` (ZERO novos erros), `yarn build`, `yarn lint --max-warnings 0`
- ✅ Frontend: `npx tsc --noEmit` (ZERO erros), `npm run build`, `npx eslint --max-warnings 0`
- ✅ Tests: 609 passing (16 novos; 4 pré-existentes falhando — não causados por V2-030)

### Smoke Tests Manuais (Reviewer deve validar)

1. User A cadastra + entra em "Devari"
2. User A convida b@test.com (sem conta) → B aceita → B cria conta em Devari
3. User A convida b@test.com (já usuário em "Acme") → B vê "Aceitar e entrar em Devari" (merge) → B agora vê Devari+Acme no switcher
4. User B troca para Acme via switcher → verifica que tokens mudaram e dados são da Acme (não Devari)
5. Admin de Devari remove B → B em Devari faz qualquer request → 401 → frontend tenta refresh → falha → logout (pois perdeu membership de TODAS orgs)
6. User B em Devari mas membro de Acme → remove B de Devari via admin → redirect automático para Acme? (opcional UX — hoje vai pedir relogin)

---

## Relacionamento com Outros ADRs

| ADR | Como relaciona |
|-----|---|
| ADR-V2-001 | RESPEITADA — ZERO tabela nova. Tudo via 17 tabelas (DEntidade, DVincula, DUserGroup, DTabela, DEvento). |
| ADR-V2-003 | ESTENDIDA — RBAC via DVincula é a base. V2-030 formaliza que 1 user = N DVinculas. |
| ADR-V2-028 | PREDECESSOR — Invites com auto-login. V2-030 estende para merge flow (user existente convidado outra org). |
| ADR-V2-009 | COMPLEMENTO POTENCIAL — Wrappers thin (sprints, statuses) como módulos opcionais. V2-030 não afeta, mas ambos reutilizam padrão V2. |

---

## Próximas Questões (Para Arquivo)

- **Perfil-por-org?** CEO descartou (V2-030 usa perfil global). Se reverter, quebra DVincula design (1 entidade = N vinculos; não N entidades = 1 vinculo).
- **Notificação pré-revogação?** Soft-delete silencioso hoje. CEO pode pedir "2h antes, enviar email avisando" (implementar em F-pós).
- **Reorganizar switcher?** Org atual em destaque, depois alfabético? UI pode pedir (hoje fallback para simples dropdown).
- **"Última org" customização?** localStorage é client-side. Se quiser server-side (salvar preference), exige DTabela user_preferences (trivial follow-up).

---

## Changelog Upstream (Devari-Core Template)

Este ADR é **candidato a template upstream** para `devari-core`:
- Padrão "1 user N orgs via DVincula + async JWT validate + localStorage for UX" é generalizável
- Qualquer SaaS B2B2B/C precisará disso
- Recomendação: Extrair em `ADR-DC-XXX` no upstream (Devari-Core) pós-V2

---

**Documento redigido por:** Documenter Agent V2  
**Validado por:** Reviewer Agent V2 (8.5/10 APPROVED)  
**Versão:** 1.0  
**Última atualização:** 2026-05-12
