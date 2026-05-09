# ADR-V2-004: API Keys e MCP Keys via DTabela (não colunas próprias)

**Status:** Aceito (implementado em F3)
**Data:** 2026-05-09
**Decisores:** Implementer Agent V2 + Reviewer Agent V2
**Tags:** #V2 #fase-F3 #auth #keys #machine-to-machine

---

## Contexto e Problema

O Scrumban-Backend-V2 precisa suportar autenticação machine-to-machine em dois contextos:

1. **API Keys:** Automações/integrações que operam em nome de um projeto (ex: webhook processor, CI/CD)
2. **MCP Keys:** Context-specific keys para ferramentas (ex: MCP servers rodando em prod que falam com a API)

Ambas precisam ser revogáveis, rastreáveis, e não devem requerer password do usuário.

**Abordagem tradicional:** Criar tabelas próprias `DApiKey(id, projectId, keyHash, createdAt, revokedAt)` e `DMcpKey(id, userId, keyHash, ...)` — mas isso viola ADR-V2-001 (ZERO tabela nova).

**Restrição:** O template Devari-Core precisa armazenar keys de forma genérica, extensível para qualquer tipo de integração.

## Alternativas Consideradas

### Opção 1: Colunas em DProject (REJEITADA)
- Adicionar `DProject.apiKeyHash VARCHAR(64)` e `DProject.mcpKeyHash VARCHAR(64)`
- **Problema:** Uma key por projeto (não suporta múltiplas keys por projeto, não suporta key rotation, não auditável com timestamps)
- **Impacto:** Inflexível. Rejeitada.

### Opção 2: Tabelas DApiKey + DMcpKey próprias (REJEITADA)
- Criar 2 tabelas canônicas especializadas
- **Problema:** Viola ADR-V2-001 (ZERO tabela nova). Polimorfismo incompleto — se houver 3º tipo de key (OAuth? Webhook secret?), precisa de 3ª tabela.
- **Impacto:** Não escala. Rejeitada.

### Opção 3: Keys via DTabela + duplicação em DUserGroup.dados (ESCOLHIDA)
- Armazenar API Key em `DTabela(-471, idClasse: API_KEY)` e MCP Key em `DTabela(-472, idClasse: MCP_KEY)`
- Campos em DTabela: `idClasse, dEntidadeId (projeto ou user), dados: { hash: "sha256...", prefix: "...", createdBy: "...", lastUsedAt: "..." }`
- **Adicionalmente:** Duplicar MCP key hash em `DUserGroup.dados.mcpKeyHash` para validação ultra-rápida (1 query vs 2)
- **Prós:**
  - ZERO tabela nova — usa DTabela canônica
  - Extensível — novo tipo de key = nova DClasse (-473, -474, etc.)
  - Auditável — DTabela tem criadoEm, atualizadoEm automáticos
  - Revogável — soft-delete via `excluido = true`
  - N+1 ZERO — índice existente em `(idClasse, dEntidadeId)`
  - Rápido — MCP validation = 1 query a DUserGroup (já buscado para auth) + compare campo Json
- **Contras:** Duplicação de hash em DUserGroup precisa de sync em revogação (transaction)

## Decisão

**Escolhemos:** Opção 3 — DTabela para master record + duplicação em DUserGroup.dados para performance

### Estrutura de DTabela

#### API Keys — DTabela com idClasse = -471

```prisma
// DTabela record
{
  chave: 12345,
  idClasse: BigInt(-471),    // API_KEY
  dEntidadeId: BigInt(proj1), // Projeto proprietário
  codigo: "api_proj1_00001",
  nome: "CI/CD Webhook Processor",
  dados: {
    hash: "2c26b46911185131f81db6a7f0fa8c97...", // SHA-256(plaintext_key)
    prefix: "sk_live_", // primeiros 8 chars do plaintext
    createdBy: "5",
    lastUsedAt: "2026-05-09T10:30:00Z",
    metadata: {
      tool: "github-actions",
      repo: "myorg/myrepo",
      branches: ["main"]
    }
  },
  inativo: false,
  excluido: false,
  criadoEm: "2026-05-01T00:00:00Z",
  atualizadoEm: "2026-05-09T10:30:00Z"
}
```

#### MCP Keys — DTabela com idClasse = -472

```prisma
// DTabela record
{
  chave: 67890,
  idClasse: BigInt(-472),     // MCP_KEY
  dEntidadeId: BigInt(user1), // Usuário proprietário
  codigo: "mcp_user1_00001",
  nome: "Production MCP Server",
  dados: {
    hash: "9f86d081884c7d6d9ffd60bb51d3d3a...",
    prefix: "mcp_prod_",
    createdBy: "5",
    lastUsedAt: "2026-05-09T11:00:00Z",
    metadata: {
      tool: "mcp-server-prod",
      version: "0.1.0"
    }
  },
  inativo: false,
  excluido: false,
  criadoEm: "2026-05-02T00:00:00Z",
  atualizadoEm: "2026-05-09T11:00:00Z"
}
```

#### MCP Key Duplicação em DUserGroup.dados

```prisma
// DUserGroup record
{
  chave: 9,
  usuario: "alice@example.com",
  idClasse: BigInt(-46),
  // ... outros campos
  dados: {
    mcpKeyHash: "9f86d081884c7d6d9ffd60bb51d3d3a...",
    refreshTokenHash: "...",
    // ... outros dados
  }
}
```

### Implementação

#### ApiKeyService

```typescript
@Injectable()
export class ApiKeyService {
  async generate(projectId: bigint, createdBy: bigint): Promise<{ key: string; prefix: string }> {
    const plaintext = crypto.randomBytes(32).toString('hex'); // 64 chars
    const hash = createHash('sha256').update(plaintext).digest('hex');
    const prefix = plaintext.slice(0, 8);

    await this.prisma.dTabela.create({
      data: {
        idClasse: BigInt(-471),
        dEntidadeId: projectId,
        codigo: `api_${projectId.toString()}_${Date.now()}`,
        dados: {
          hash,
          prefix,
          createdBy: createdBy.toString(),
          lastUsedAt: null,
          metadata: {},
        },
      },
    });

    return { key: plaintext, prefix };
  }

  async validate(plaintext: string): Promise<{ projectId: bigint } | null> {
    const hash = createHash('sha256').update(plaintext).digest('hex');

    // Query 1: encontrar key
    const found = await this.prisma.dTabela.findFirst({
      where: {
        idClasse: BigInt(-471),
        excluido: false,
        inativo: false,
      },
    });

    // Filtro em app (aceitável para volume < 100 keys por projeto)
    // F14: considerar raw query com jsonb operator se volume > 100
    if (!found || found.dados['hash'] !== hash) return null;

    // Update lastUsedAt
    await this.prisma.dTabela.update({
      where: { chave: found.chave },
      data: { dados: { ...found.dados, lastUsedAt: new Date().toISOString() } },
    });

    return { projectId: found.dEntidadeId };
  }

  async revoke(keyId: bigint): Promise<void> {
    await this.prisma.dTabela.update({
      where: { chave: keyId },
      data: { excluido: true },
    });
  }

  async listByProject(projectId: bigint): Promise<DTabela[]> {
    return await this.prisma.dTabela.findMany({
      where: {
        idClasse: BigInt(-471),
        dEntidadeId: projectId,
        excluido: false,
      },
    });
  }
}
```

#### McpKeyService

```typescript
@Injectable()
export class McpKeyService {
  async generate(userId: bigint): Promise<{ key: string; prefix: string }> {
    const plaintext = crypto.randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(plaintext).digest('hex');
    const prefix = plaintext.slice(0, 8);

    // Transaction: salvar em DTabela + duplicar em DUserGroup.dados
    await this.prisma.$transaction([
      this.prisma.dTabela.create({
        data: {
          idClasse: BigInt(-472),
          dEntidadeId: userId,
          codigo: `mcp_${userId.toString()}_${Date.now()}`,
          dados: {
            hash,
            prefix,
            createdBy: userId.toString(),
            lastUsedAt: null,
          },
        },
      }),
      this.prisma.dUserGroup.update({
        where: { chave: userId },
        data: {
          dados: {
            mcpKeyHash: hash,
            // preservar outros campos em dados
          },
        },
      }),
    ]);

    return { key: plaintext, prefix };
  }

  async validate(plaintext: string, userGroupId?: bigint): Promise<{ userId: bigint } | null> {
    const hash = createHash('sha256').update(plaintext).digest('hex');

    // Caminho rápido: se userGroupId fornecido, comparar apenas com dados.mcpKeyHash
    if (userGroupId) {
      const user = await this.prisma.dUserGroup.findUnique({
        where: { chave: userGroupId },
        select: { dados: true },
      });
      if (user?.dados?.mcpKeyHash === hash) return { userId: userGroupId };
    }

    // Caminho completo: buscar em DTabela
    const found = await this.prisma.dTabela.findFirst({
      where: {
        idClasse: BigInt(-472),
        excluido: false,
        inativo: false,
      },
    });

    if (!found || found.dados['hash'] !== hash) return null;

    await this.prisma.dTabela.update({
      where: { chave: found.chave },
      data: { dados: { ...found.dados, lastUsedAt: new Date().toISOString() } },
    });

    return { userId: found.dEntidadeId };
  }

  async revoke(userId: bigint): Promise<void> {
    // Transaction: soft-delete em DTabela + limpar hash em DUserGroup
    await this.prisma.$transaction([
      this.prisma.dTabela.updateMany({
        where: {
          idClasse: BigInt(-472),
          dEntidadeId: userId,
          excluido: false,
        },
        data: { excluido: true },
      }),
      this.prisma.dUserGroup.update({
        where: { chave: userId },
        data: {
          dados: {
            mcpKeyHash: null,
          },
        },
      }),
    ]);
  }
}
```

#### Guards

**ApiKeyGuard:**
```typescript
@Injectable()
export class ApiKeyGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) return false; // Sem header, deixar proximos guards tentarem

    const result = await this.apiKeyService.validate(apiKey);
    if (result) {
      req['project'] = { id: result.projectId };
      return true;
    }

    return false; // Inválido, deixar proximos guards tentarem
  }
}
```

**McpKeyGuard:**
```typescript
@Injectable()
export class McpKeyGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const mcpKey = req.headers['x-mcp-key'];

    if (!mcpKey) return false;

    // Usar userGroupId do JWT expirado se disponível (performance)
    const userGroupId = req.user?.sub ? BigInt(req.user.sub) : undefined;
    const result = await this.mcpKeyService.validate(mcpKey, userGroupId);

    if (result) {
      req['user'] = { sub: result.userId };
      return true;
    }

    return false;
  }
}
```

## Consequências

### Positivas

1. **ZERO tabela nova** — Reutiliza DTabela canônica
2. **Extensível** — Novo tipo de key (webhook secret, OAuth token) = nova DClasse
3. **Auditável** — Cada key é registro em DTabela com criadoEm, atualizadoEm, lastUsedAt
4. **Revogável** — Soft-delete via `excluido = true` preserva histórico
5. **Eficiente** — MCP validation = 1 query (DUserGroup já buscado) + compare campo
6. **Multi-key** — Projeto pode ter múltiplas API Keys, usuário pode ter múltiplas MCP Keys
7. **Rotação rápida** — Gerar nova key, revogar antiga em transaction — sem downtime

### Negativas

1. **Duplicação em DUserGroup.dados** — Precisão eventual (até sync)
2. **Busca por hash em Json** — Para volume > 100 keys, pode precisar índice GIN (F14)
3. **Sem índice específico** — DTabela usa índice genérico em (idClasse, dEntidadeId) — risco para volume extremo

## Implementação

### Fase F3 — Auth + RBAC Duplo

Arquivos criados/modificados:
- `src/auth/services/api-key.service.ts` — generate, validate, revoke, listByProject
- `src/auth/guards/api-key.guard.ts` — ApiKeyGuard com X-API-Key header
- `src/auth/services/mcp-key.service.ts` — generate com transaction, validate com caminho rápido, revoke com sync
- `src/auth/guards/mcp-key.guard.ts` — McpKeyGuard com X-MCP-Key header
- `src/auth/auth.controller.ts` — Endpoints POST/GET/DELETE /auth/me/api-key e /auth/me/mcp-key
- Tests: `src/auth/services/api-key.service.spec.ts`, `src/auth/services/mcp-key.service.spec.ts`

### Validação (DoD F3)

- [ ] API Keys armazenadas em DTabela(-471) com hash SHA-256
- [ ] MCP Keys armazenadas em DTabela(-472) com hash duplicado em DUserGroup.dados
- [ ] ApiKeyGuard lê X-API-Key header, valida via ApiKeyService, popula req['project']
- [ ] McpKeyGuard lê X-MCP-Key header, valida via McpKeyService, popula req['user']
- [ ] AuthCompositeGuard tenta MCP→API Key→JWT (guards não lançam, apenas retornam true/false)
- [ ] Revogação atomicamente atualiza DTabela + DUserGroup.dados em transaction
- [ ] Plaintext key retornado UMA VEZ ao criar (não reexibido em GET)
- [ ] Testes: 10+ specs cobrindo generate/validate/revoke para ambos os tipos

## Notas

- **Performance (F14):** Se volume > 100 API Keys por projeto, adicionar índice GIN em `DTabela.dados` ou usar raw query Postgres com `jsonb_path_query`.
- **Multi-instância (F14):** Cache em-memory de MCP key hash pode divergir até 5min em múltiplos pods — considerar Redis na F14.
- **Rotação:** Implementar endpoint para "rotate API Key" = gerar novo + revogar antigo em transaction.

---

## Referências

- **ADR-V2-001:** 17 tabelas canônicas — zero tabela nova é inviolável
- **Código:**
  - `src/auth/services/api-key.service.ts`
  - `src/auth/services/mcp-key.service.ts`
  - `src/auth/guards/api-key.guard.ts`
  - `src/auth/guards/mcp-key.guard.ts`
  - Tests: `src/auth/**/*.spec.ts`
- **Docs:**
  - `workspace/plans/plan-auth-rbac-f3-task1.md` §3 (Decisão D4)
  - `workspace/implementations/impl-auth-rbac-f3-task1.md`
  - `workspace/reviews/review-auth-rbac-f3-task1.md`
