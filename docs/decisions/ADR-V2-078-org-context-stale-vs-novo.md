# ADR-V2-078: Distinguir `ORG_CONTEXT_STALE` de "Usuário Novo Sem Projetos"

**Status:** Aceito (Score 8.5/10, Reviewer aprovado)
**Data:** 2026-07-13
**Decisores:** Reviewer Agent V2, Strategist (plano `plan-sessao-auth-hardening.md` §5 FASE 4)
**Tags:** #V2 #fase-F4 #auth #incidente-DEV-174 #multi-tenant

---

## Contexto e Problema

### O Sintoma — "Sumiram Todos os Meus Projetos"

Usuário logado em uma organização vê sua lista de projetos vazia **sem nenhuma mensagem de erro**. O sistema responde 200 OK com `projects: []`, indistinguível de "usuário legítimo que não tem projetos".

Raiz da confusão: dois cenários produzem lista vazia, indistinguíveis ao observar apenas o status HTTP e o payload:

| Cenário | Causa | Erro? | Visível? |
|---------|-------|-------|----------|
| **A. Usuário novo** | Usuário foi criado hoje, ainda sem projetos atribuídos | Não (200) | ❌ Invisível |
| **B. Org context stale** | Usuário foi removido da org (ou org foi deletada) mas o JWT ainda contém `organizationId` antigo | **Sim (401)** | ❌ Invisível (era 200) |

Antes da F4, cenário B devolvia 200 com lista vazia — impossível distinguir de A apenas pelo HTTP status.

### Por Que É Crítico

Sem distinção clara:

1. **Experiência de usuário degradada:** o usuário pensa que "o sistema apagou meus projetos" e tenta relogar várias vezes (multiplicador de carga)
2. **Investigação difícil:** no suporte, "meus projetos sumiram" é reportado 3 vezes por semana — mas é impossível dizer se é stale, permissão removida, ou bug
3. **Divergência entre réplicas:** em multi-replica, cache de role desatualizado num servidor vs. sincronizado em outro → lista vazia numa réplica, 403 em outra (inconsistência observável do cliente)
4. **Loop de refresh silencioso:** se o frontend tenta refresh silencioso em 200 vazio legítimo (usuário novo), o refresh vai demorar e o usuário fica vendo "carregando..." sem motivo

---

## Alternativas Consideradas

### Opção 1: Manter 200 vazio (status quo)

**Prós:**
- Zero mudança no endpoint
- Compatível com clientes antigos

**Contras:**
- Impossível distinguir usuário novo de org stale no cliente
- Usuario stale pensa que sistema bugou (não é refresh, é stale)
- Incidente de suporte por semana (custo)

**Rejeição:** não resolve o problema.

---

### Opção 2: Sempre validar membership em 100% das requests

Verificar `DVincula` com os ORG_ROLE_CLASSES para TODA request em `/projects` e `/tasks`, mesmo quando a lista vem completa.

**Prós:**
- Detecta stale em qualquer situação (não só lista vazia)

**Contras:**
- Query extra em 100% das requests → latência
- Postgres agora no caminho crítico de TODA operação
- Com cache L1/L2 de role (F4.1), sem cache essa alternativa não é viável

**Adoptado com restrição:** aplica-se SOMENTE quando a lista vem vazia (custo zero no caminho feliz).

---

### Opção 3: 401 `ORG_CONTEXT_STALE` somente quando lista vazia + membership inválido

Validar membership SOMENTE após confirmar que `accessibleProjectIds` veio vazio. Se vazio + sem membership → 401. Senão, 200 com lista.

**Prós:**
- Custo zero no caminho feliz (usuário com projetos paga zero queries)
- Distingue usuário novo (200 vazio + membership OK) de stale (401 + membership falta)
- Frontend sabe o que fazer: refresh silencioso se 401, aceita 200 se novo
- Backwards-compatible: cliente antigo ignora 401, retenta, eventualmente cai no refresh

**Contras:**
- Requer lógica de two-phase (primeiro lista, depois valida)
- Implementação ligeiramente mais complexa

**Adoção:** ✅ Escolhido.

---

## Decisão

### Regra Fundacional: Distinção via DVincula, Não via Lista

A lista vazia em si NÃO é erro. O que É erro é:

```
lista vazia + JWT contém organizationId + usuário NÃO TEM membership ativa
```

Esse é o único cenário que dispara 401 `ORG_CONTEXT_STALE`.

### Implementação

**Passo 1: Carregar lista de projetos**

```typescript
const accessibleProjectIds = await this.getAccessibleProjectIds(
  userEntidadeId,
  organizationId
);
// Retorna: Set<BigInt> — pode estar vazio (usuário novo) ou cheio (normal)
```

**Passo 2: Se lista vazia, validar contexto**

```typescript
if (accessibleProjectIds.size === 0) {
  const status = await this.assertOrgContextFresh(
    userEntidadeId,
    organizationId,
    'ProjectsService.findMany'
  );
  // Se stale → lança 401 { code: 'ORG_CONTEXT_STALE' }
  // Se fresh → retorna sem erro, lista fica vazia
}

// Passo 3: Retornar resultado (vazio ou cheio)
return {
  items: [],  // Ou itens se havia
  pagination: { hasMore: false, total: 0 }
};
```

**O que `assertOrgContextFresh` faz (projeto atual do arquivo `projects.service.ts:1068-1107`):**

1. Se `organizationId === undefined` → retorna `'orphan'` (válido, user é órfão em relação a org — ADR-V2-038)
2. Se `organizationId` presente → procura `DVincula` ativa (ORG_ROLE_CLASSES: -161, -162, -163) com `idLocEscritu=organizationId`
3. Se found → retorna `'fresh'` (usuário ainda é membro válido)
4. Se NOT found → lança `UnauthorizedException { code: 'ORG_CONTEXT_STALE' }` (usuário saiu/foi removido)
5. Se Prisma error → retorna `'fresh'` (fail-open: infra flaky NUNCA vira 401 — RFC 6750)

---

## Consequências

### Positivas

1. **Usuário novo distinguido de stale:** cliente recebe 200 vazio (novo) vs 401 stale (removido)
2. **Refresh automático no cliente:** 401 dispara refresh silencioso + retry (ADR-V2-076 + plan §2.5)
3. **Custo zero no caminho feliz:** usuário com 10 projetos paga zero queries de membership (query só em lista vazia)
4. **Coerência multi-replica:** cache L1/L2 de role (F4.1) garante que todas as réplicas vejam o mesmo membership
5. **Falha segura:** infra lenta (Prisma timeout) → fail-open → 200 vazio (nunca logout por infra)

### Negativas

1. **Pequeno latência delta em lista vazia:** +1 query de membership (negligenciável, já que era 0 queries antes)
2. **Comportamento diferente de 403:** usuário sem nenhum acesso recebe 404 (anti-enumeração), mas user com org stale recebe 401 (por design — o claim está no token, é informação do cliente)

### Riscos Mitigados

| Risco | Mitigação |
|-------|-----------|
| Usuário novo toma 401 e deslogar | Impossível — novo está em org que foi CONVIDADO; membership sempre existe naquele momento |
| Tempestade de refresh em 401 stale | Não — `executeRefreshV2` (Auth F1) recalcula org a partir de membership REAL; novo token vem correto ou órfão (não repete o stale) |
| 401 quando Postgres está down | Não — fail-open em PrismaClientKnownRequestError; retorna 200 vazio (usuário vê "carregando") |
| Divergência entre réplicas | Não — L2 Redis cache de role garante coerência ≤300s; L1 in-process (5s) para rajadas |

---

## Implementação

### Code Locations

- **Query de membership:** `src/projects/projects.service.ts:1085-1093` (DVincula.findFirst com ORG_ROLE_CLASSES)
- **Check de stale:** `src/projects/projects.service.ts:1068-1107` (método `assertOrgContextFresh`)
- **Call-sites:** `src/projects/projects.service.ts:822+` (dentro de `if (allIds.size === 0)`)
- **Tasks controller:** `src/tasks/tasks.controller.ts:107+` (resolveScopedProjectIds usa mesmo padrão)

### Tests Implementados (Fase 4 — Task #998)

**File:** `src/auth/__tests__/org-context-stale.spec.ts` (6/6 PASS)

| Teste | Cenário | Resultado |
|-------|---------|-----------|
| org-context-stale (A) | Usuário NO membro de org, list vazia → 401 stale | ✅ 401, `code: ORG_CONTEXT_STALE` |
| org-context-stale (B) | Usuário NOVO em org, list vazia → 200 OK | ✅ 200, items=[], sem erro |
| org-context-stale (C) | Usuário MEMBRO, list cheia → 200 OK, sem query membership | ✅ 200, assertOrgContextFresh NÃO chamado |
| org-context-stale (D) | Infra falha (Prisma timeout) → fail-open 200 | ✅ 200, lista vazia (nunca 401) |
| org-context-stale (E) | Token SEM organizationId (órfão) → 200 | ✅ 200, lista vazia (válido per ADR-V2-038) |
| org-context-stale (F) | Token com organizationId inválido (não número) → 401 stale | ✅ 401, `code: ORG_CONTEXT_STALE` |

**Nota sobre teste (B):** O teste-guarda CRÍTICO. Verifica que um usuário novo (membership existe, lista vazia) recebe 200, NÃO 401. Implementado com mock real: `prisma.dVincula.findFirst().mockResolvedValue({ chave: BigInt(9), idClasse: BigInt(-162) })` — não é mock vazio que passa por default.

### Behavior on Stale

1. **Server responde:** `401 { code: 'ORG_CONTEXT_STALE', message: '...' }`
2. **Frontend vê 401 com code stale** (interceptor em `src/lib/api.ts:115-194`, implementado em F2/F4.4)
3. **Frontend ação:**
   - POST /auth/refresh { refreshToken } (sem logout)
   - Se sucesso: novo token sem `organizationId` (órfão) OU correto se re-convidado
   - Retenta request original
4. **Result:**
   - Usuário removido: 401 permanece, mais um refresh → logout (ADR-V2-064 scenario 4)
   - Usuário re-convidado: novo token tem org correta → 200 (cura automática)

---

## Decisões Relacionadas

### ADR-V2-003 — RBAC Duplo via DVincula

A lookup de membership usa `DVincula.idClasse in ORG_ROLE_CLASSES` (-161, -162, -163). Não é coluna específica — é polimorfismo. Isso permite futuros roles de org sem migration:

```typescript
// Hoje
const ORG_ROLE_CLASSES = [
  BigInt(-161),  // ORG_MANAGER
  BigInt(-162),  // ORG_MEMBER
  BigInt(-163)   // ORG_VIEWER
];

// Futuro: adicionar ORG_CUSTOM sem alterar query
const ORG_ROLE_CLASSES = [
  BigInt(-161),
  BigInt(-162),
  BigInt(-163),
  BigInt(-1XX)   // Nova role, mesma query, zero migration
];
```

---

### ADR-V2-038 — Refresh Órfão (não Broken)

Usuário removido de TODAS as orgs obtém token **sem** `organizationId` (órfão). Isso NÃO é erro — é estado válido (ADR-V2-038). Um órfão em 200 vazio é legítimo.

Mas um órfão tentando acessar um projeto ESPECÍFICO recebe 403 `NO_WORKSPACE` (OrgTenantGuard, antes dessa check). Sequência:
1. 401 stale com organizationId velho → refresh → token sem org
2. GET /projects (sem context) → 200 vazio (órfão é válido)
3. Mas RequireWorkspaceGuard em route protegida → 403 NO_WORKSPACE (força escolher uma org)

---

## Observação: Gap Pré-Existente Não Coberto

### VIEWER Tentando Escrever

O `docs/auth-error-codes.md:150` descreve: "VIEWER tenta deletar card → 403 `FORBIDDEN_ROLE`".

**Realidade:** o código atual só cobre o caso de template global (idEstab=NULL). Um VIEWER em um projeto normal consegue escrever — o check em `assertTaskWritable` usa `accessibleProjectIds.includes(projectId)`, que inclui VIEWER (permissão de leitura).

**Status:** Comportamento pré-existente (não regressão da F4). A doc superestima o que está implementado.

**Ação:** corrigir `docs/auth-error-codes.md` para ser honesto: "Hoje somente tasks em templates globais retornam 403 FORBIDDEN_ROLE. Cenário VIEWER genérico é follow-up pendente."

---

## Métricas (Observabilidade — F0)

Contadores relevantes (emitidos em F0, validados em F4):

| Métrica | Significado |
|---------|------------|
| `auth.org_context_stale` | Vezes que org stale foi detectado (zero antes da F4) |
| `auth.org_context_stale.membership_missing` | User não é membro (principal) |
| `auth.org_context_stale.invalid_claim` | Token com organizationId malformado |
| `auth.org_context_stale.fail_open` | Infra falhou, fail-open retornou fresh |

Post-F4, `auth.org_context_stale > 0` prova que o case existia (e agora é visível + tratado).

---

## Próximas Fases

- **F4.1:** Cache L1/L2 de role (RoleResolverService) + Redis pub/sub `role:invalidate` — garante coerência multi-replica
- **F4.2:** Garantir que `code` é propagado em 100% dos endpoints de auth (não só refresh)
- **F4.5:** Frontend consome `code` e faz ações corretas (já implementado em F2)

---

## Referências

- **Plan:** `workspace/plans/plan-sessao-auth-hardening.md` §5 Fase 4
- **Review:** `workspace/reviews/review-auth-org-context-stale-task4.md` (Score 8.5/10)
- **Relacionados:** ADR-V2-038 (refresh órfão), ADR-V2-003 (RBAC), ADR-V2-076 (grace window)
- **Contrato:** `docs/auth-error-codes.md` (consumo de código pelo frontend)
- **Instrumentação:** F0 observabilidade (baseline de `auth.org_context_stale`)

---

**Maintained by:** Documenter Agent V2  
**Versão:** 1.0 (F4, Task #998)  
**Status:** Aceito após Reviewer Score 8.5/10, testes-guarda verdes, zero regressão
