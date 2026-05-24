# Rollback — Integração Frontend V2 (Blocos A e B)

**Branch de integração:** `feature/integracao-frontend-v2-hierarquia`
**Branch de produção anterior:** `main`
**Data de deploy:** a preencher no momento do deploy
**Autor:** Benedito / Devari Tecnologia

---

## Quando usar este rollback

Se após o deploy da branch `feature/integracao-frontend-v2-hierarquia` surgir
qualquer problema crítico em produção e você precisar voltar ao estado anterior.

---

## Passo a passo do rollback

### 1. Frontend — reverter no CI/CD

No painel do CI/CD (Dokploy ou equivalente):

- Troque a branch de `feature/integracao-frontend-v2-hierarquia` de volta para `main`
- Faça o deploy
- O frontend volta ao modo mock (`NEXT_PUBLIC_MOCK_AUTH=true`) automaticamente

**Tempo estimado:** 2-3 minutos

---

### 2. Backend — reverter no CI/CD

No painel do CI/CD:

- Troque a branch de `feature/integracao-frontend-v2-hierarquia` de volta para `main`
- Faça o deploy (o código volta ao estado anterior)

**Tempo estimado:** 2-3 minutos

---

### 3. Banco de dados — desfazer a migration (opcional)

> **IMPORTANTE:** Este passo só é necessário se o banco estiver causando
> problema. Se o código voltou para `main` e tudo funciona, você pode
> deixar as colunas `idPai` e `privado` no banco — elas são nullable e
> não afetam o código antigo.

Se precisar remover as alterações do banco, conecte ao PostgreSQL de produção
e execute os seguintes comandos **nesta ordem exata:**

```sql
-- Passo 1: remover índices compostos
DROP INDEX IF EXISTS "DProject_excluido_idPai_idx";
DROP INDEX IF EXISTS "DProject_idPai_idx";

-- Passo 2: remover a foreign key constraint
ALTER TABLE "DProject" DROP CONSTRAINT IF EXISTS "DProject_idPai_fkey";

-- Passo 3: remover as colunas (em ordem inversa à criação)
ALTER TABLE "DProject" DROP COLUMN IF EXISTS "privado";
ALTER TABLE "DProject" DROP COLUMN IF EXISTS "idPai";
```

**Tempo estimado:** menos de 1 minuto (migration aditiva — rollback é trivial)

---

### 4. Seed — desfazer as 6 DClasses (opcional)

> **IMPORTANTE:** Este passo raramente será necessário. As DClasses novas
> não afetam o funcionamento do sistema legado — são apenas registros
> extras na tabela DClasse.

Se precisar remover as 6 DClasses adicionadas pelo Bloco A:

```sql
DELETE FROM "DClasse"
WHERE "chave" IN (-187, -188, -350, -351, -352, -353);
```

---

## O que NÃO é afetado pelo rollback

- Dados de usuários, organizações, projetos e tasks existentes — **intocados**
- A coluna `repoUrl` no DProject — **permanece** (foi adicionada antes desta branch)
- Qualquer outro dado do banco — **intocado**

---

## Resumo das alterações desta branch

### Backend
| Arquivo | O que mudou | Reversível como |
|---|---|---|
| `prisma/seeds/classes.seed.ts` | +6 DClasses (-187/-188/-350/-351/-352/-353) | DELETE 6 linhas no banco (SQL acima) |
| `prisma/schema.prisma` | +`idPai BigInt?` e `privado Boolean` em DProject | SQL de rollback acima |
| `prisma/migrations/20260524213600_*` | Migration aplicada no banco | SQL de rollback acima |
| `src/projects/utils/anti-cycle.util.ts` | Arquivo novo (anti-ciclo CTE) | Volta com o código da branch `main` |
| `src/projects/projects.service.ts` | Anti-ciclo no update(), cascade no delete(), seedBootstrap condicional no create() | Volta com o código da branch `main` |
| `src/projects/dto/update-project.dto.ts` | Campo `idPai` adicionado | Volta com o código da branch `main` |

### Frontend
| Arquivo | O que mudou | Reversível como |
|---|---|---|
| `.env.local` | `MOCK_AUTH=false`, porta 3001 | Volta com o código da branch `main` |
| `package.json` | Script dev na porta 3001 | Volta com o código da branch `main` |
| `src/hooks/use-auth.ts` | `useSwitchOrg()` adicionado | Volta com o código da branch `main` |
| `src/lib/mock/auth.ts` | `mockSwitchOrg()` adicionado | Volta com o código da branch `main` |
| `src/components/shell/workspace-switcher.tsx` | Orgs reais + loading states | Volta com o código da branch `main` |

---

## Commits desta branch (para referência)

### Backend
```
19715e0 docs(v2): documenta Bloco B — autenticação real + workspace switcher
d5fa82e docs(v2): documenta Bloco A — hierarquia DProject Space/Folder/List
bf2730a test(v2): corrige specs delete cascade e seedBootstrap condicional
e5f85fc feat(v2): anti-ciclo CTE + cascade soft-delete + seedBootstrap condicional
b393688 feat(v2): migration DProject idPai + privado — hierarquia Space/Folder/List
c6d368a fix(v2): corrige agrupamento false em SPACE e FOLDER (-350/-351)
c8df4bd feat(v2): adiciona 6 DClasses hierarquia Space/Folder/List + Bookmark + Doc
```

### Frontend
```
8988e8b docs(v2): documenta Bloco B — autenticação real + workspace switcher
d2d05d8 feat(v2): workspace switcher multi-org conectado ao backend real (B2)
28203b6 feat(v2): conecta frontend auth ao backend real — login/register/logout/refresh (B1)
```

---

*Documento criado em 2026-05-24*
*Referência: workspace/plans/plan-integracao-frontend-v2-task2.md*
