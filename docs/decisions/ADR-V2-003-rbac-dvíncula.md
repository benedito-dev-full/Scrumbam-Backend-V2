# ADR-V2-003: RBAC Duplo via DVincula + idClasse (sem DProjectMember, sem enums)

**Status:** Aceito (implementado em F3)
**Data:** 2026-05-09
**Decisores:** Implementer Agent V2 + Reviewer Agent V2
**Tags:** #V2 #fase-F3 #auth #rbac

---

## Contexto e Problema

O Scrumban-Backend-V2 é um SaaS multi-tenant que requer isolamento de dados em dois níveis:

1. **Nível Org:** Quem pode gerenciar a organização (ADMIN/MEMBER/VIEWER)
2. **Nível Project:** Quem pode acessar cada projeto dentro de uma organização (MANAGER/MEMBER/VIEWER)

A abordagem tradicional cria uma tabela `DProjectMember` com coluna `role: enum('ADMIN', 'MEMBER', 'VIEWER')` — mas isso viola ADR-V2-001 (ZERO tabela nova) e Pilar 2 (reutilizar tabelas canônicas).

**Restrição:** O template Devari-Core não pode assumir estrutura de roles enum — precisa ser extensível para qualquer domínio de negócio.

## Alternativas Consideradas

### Opção 1: Coluna `role` em DUserGroup (REJEITADA)
- Armazenar `DUserGroup.role = 'ADMIN'`
- **Problema:** Usuário tem apenas UM role — não funciona para múltiplos projetos/organizações. Usuário pode ser ADMIN da Org A e VIEWER da Org B.
- **Impacto:** Inviável para multi-tenant. Rejeitada imediatamente.

### Opção 2: Tabela DProjectMember própria (REJEITADA)
- Criar `DProjectMember(userGroupId, projectId, role)`
- **Problema:** Viola ADR-V2-001 (ZERO tabela nova). Cria duplicação de conceitos — já existe DVincula para relações.
- **Impacto:** Não canônico. Rejeitada.

### Opção 3: Roles via DVincula + idClasse (ESCOLHIDA)
- Usar `DVincula` (tabela canônica para relações) com `idClasse` = role type
- DClasses: `-161` ADMIN, `-162` MEMBER, `-163` VIEWER (Org); `-171` MANAGER, `-172` MEMBER, `-173` VIEWER (Project)
- Query: `SELECT FROM DVincula WHERE idLocEscritu = :orgId AND idEntidade = :userId AND idClasse IN (-161, -162, -163) AND excluido = false`
- **Prós:**
  - ZERO tabela nova — usa DVincula canônica
  - Extensível — adicionar nova role = adicionar nova DClasse, nenhuma migration SQL
  - Polimórfica — mesmo mecanismo funciona para teams, grupos, etc. em F5+
  - N+1 ZERO — `@@index([idLocEscritu, idClasse])` já no schema
  - Suporta múltiplos roles por usuário (user é ADMIN em Org A, MEMBER em Org B)
- **Contras:** Query manual vs enum — trade-off aceitável por flexibilidade

## Decisão

**Escolhemos:** Opção 3 — Roles via DVincula + idClasse

### Estrutura de DClasses

| Contexto | Role Type | DClasse | Descrição |
|----------|-----------|---------|-----------|
| Organization | ADMIN | -161 | Gerencia organização, convida membros, configura permissões |
| Organization | MEMBER | -162 | Acessa projetos da org, contribui em sprints |
| Organization | VIEWER | -163 | Acesso somente leitura a projetos públicos da org |
| Project | MANAGER | -171 | Gerencia projeto: cria sprints, atualiza status, remove membros |
| Project | MEMBER | -172 | Contribui ao projeto (cria tasks, comenta) |
| Project | VIEWER | -173 | Acesso somente leitura ao projeto |

### Implementação

#### DVincula Schema (já canônico)

```prisma
model DVincula {
  chave          BigInt      // PK
  idClasse       BigInt      // FK DClasse (-161 ADMIN_ORG, -162 MEMBER_ORG, etc.)
  idLocEscritu   BigInt      // FK DEntidade — proprietário/contexto (org ou project)
  idEntidade     BigInt?     // FK DEntidade — alvo (usuário)
  tipo           String?     // Adicional: 'PRIMARY', 'SECONDARY' para roles
  nome           String?
  percentual     Decimal(5,2)?
  // ... outros campos
  
  @@index([idLocEscritu, idClasse])  // Crítico para N+1 ZERO
}
```

#### RoleResolverService (N+1 ZERO com LRU Cache)

```typescript
@Injectable()
export class RoleResolverService {
  private cache = new LruCache<string, string>(1000, 300000); // 5min TTL

  async getOrgRole(userId: bigint, orgId: bigint): Promise<'ADMIN' | 'MEMBER' | 'VIEWER' | null> {
    const cacheKey = `org:${orgId}:${userId}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached as any;

    const vinculo = await this.prisma.dVincula.findFirst({
      where: {
        idLocEscritu: orgId,
        idEntidade: userId,
        idClasse: { in: [BigInt(-161), BigInt(-162), BigInt(-163)] },
        excluido: false,
      },
      select: { idClasse: true },
    });

    let role: string | null = null;
    if (vinculo?.idClasse === BigInt(-161)) role = 'ADMIN';
    else if (vinculo?.idClasse === BigInt(-162)) role = 'MEMBER';
    else if (vinculo?.idClasse === BigInt(-163)) role = 'VIEWER';

    if (role) this.cache.set(cacheKey, role);
    return role || null;
  }

  // Análogo para getProjectRole com (-171, -172, -173)

  invalidateUser(userId: bigint): void {
    // Limpar todas entradas com esse userId do cache
    // (necessário ao revogar vínculo)
  }
}
```

#### RolesGuard

```typescript
@Injectable()
export class RolesGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const reflector = new Reflector();
    const requiredRoles = reflector.getAllAndOverride<string[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) return true; // Sem @Roles → permitir

    const req = context.switchToHttp().getRequest();
    const user = req.user; // JwtPayload { sub, entidadeId, organizationId }

    const userRole = await this.roleResolver.getOrgRole(
      BigInt(user.sub),
      BigInt(user.organizationId)
    );

    if (!userRole || !requiredRoles.includes(userRole)) {
      throw new ForbiddenException('Insufficient role');
    }

    return true;
  }
}
```

#### AuthCompositeGuard — Ordem de autenticação (MCP → API Key → JWT)

```typescript
@Injectable()
export class AuthCompositeGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

    // 1. MCP Key (ferramenta específica com contexto máximo)
    const mcpKeyAuth = await this.mcpKeyGuard.canActivate(context);
    if (mcpKeyAuth) {
      req['authMethod'] = 'mcpkey';
      return true;
    }

    // 2. API Key (automação/integração com contexto de projeto)
    const apiKeyAuth = await this.apiKeyGuard.canActivate(context);
    if (apiKeyAuth) {
      req['authMethod'] = 'apikey';
      return true;
    }

    // 3. JWT (sessão de usuário, contexto genérico)
    const jwtAuth = await this.jwtAuthGuard.canActivate(context);
    if (jwtAuth) {
      req['authMethod'] = 'jwt';
      return true;
    }

    // Nenhum mecanismo validou
    throw new UnauthorizedException('No valid authentication method');
  }
}
```

## Consequências

### Positivas

1. **ZERO tabela nova** — Reutiliza DVincula canônica
2. **ZERO migration SQL** — Adicionar role = criar DClasse (seed)
3. **Extensível** — Mesmo mecanismo funciona para teams (F5), grupos, etc.
4. **N+1 ZERO** — `@@index([idLocEscritu, idClasse])` já existe; 1 query + LRU cache
5. **Multi-role** — Usuário pode ter diferentes roles em diferentes contextos
6. **Auditável** — Cada vínculo é registro em DVincula com timestamps (criadoEm, atualizadoEm)

### Negativas

1. **Query manual vs enum** — Melhorias futuras podem requer índices adicionais (mitigável com índices)
2. **Carga de cache** — Em-memory cache é por-instância (em múltiplos pods, divergência até 5min) — mitigável migração para Redis em F14

## Implementação

### Fase F3 — Auth + RBAC Duplo

Arquivos criados/modificados:
- `src/auth/services/role-resolver.service.ts` — RoleResolverService com LRU cache
- `src/auth/guards/roles.guard.ts` — RolesGuard com verificação de role via DVincula
- `src/auth/decorators/roles.decorator.ts` — @Roles('ADMIN'|'MEMBER'|'VIEWER')
- `src/auth/guards/auth-composite.guard.ts` — Composite guard com ordem MCP→API Key→JWT
- `src/auth/auth.service.ts` — AuthService.register cria DVincula(-161) automaticamente
- Tests: `src/auth/services/role-resolver.service.spec.ts`, `src/auth/guards/roles.guard.spec.ts`

### Validação (DoD F3)

- [ ] ZERO coluna `role` em DUserGroup ou DEntidade (grep confirmou)
- [ ] DVincula com idClasse (-161/-162/-163 Org, -171/-172/-173 Project) funcional
- [ ] RoleResolverService com LRU cache testado (spec de N+1 ZERO em getOrgRole)
- [ ] RolesGuard rejeita usuário sem role suficiente (spec de ForbiddenException)
- [ ] AuthCompositeGuard tenta MCP→API Key→JWT na ordem correta (spec de ordem)
- [ ] Testes: 10+ specs cobrindo todos os paths

## Notas

- **Q1 CEO (não bloqueia F3):** `OrgTenantGuard` com estratégia `PATH_PARAM` lê `orgId` do path. Em F5 (DProject), path será `/projects/:projectId` — isolamento será via `DProject.idEstab` (FK para org). Confirmar se adiciona 1 query extra por request.
- **Future (F5):** TeamRolesGuard análogo com DVincula -181 TEAM_MEMBERSHIP (sem role — apenas membership).
- **Future (F14):** Migrar LRU cache in-memory para Redis quando múltiplos pods.

---

## Referências

- **ADR-V2-001:** 17 tabelas canônicas — zero tabela nova é inviolável
- **Pilar 2 (Devari-Core):** Endpoints genéricos reutilizados
- **Código:**
  - `src/auth/services/role-resolver.service.ts`
  - `src/auth/guards/roles.guard.ts`
  - `src/auth/guards/auth-composite.guard.ts`
  - `src/auth/auth.service.ts` (register com DVincula automático)
  - Tests: `src/auth/**/*.spec.ts`
- **Docs:**
  - `workspace/plans/plan-auth-rbac-f3-task1.md` §3 (Decisões Arquiteturais D1-D4)
  - `workspace/implementations/impl-auth-rbac-f3-task1.md`
  - `workspace/reviews/review-auth-rbac-f3-task1.md`
