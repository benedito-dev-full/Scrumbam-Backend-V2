# Runbook — Backfill PROJECT_REF (-158) + índice de expressão Json

**ADR:** ADR-V2-058 (DEntidade-espelho `-158 PROJECT_REF` como handle canônico de projeto em DVincula)
**Fase:** 3 — Migration de índice + backfill idempotente
**Migration:** `prisma/migrations/20260602000000_add_project_ref_json_index/`
**Script:** `prisma/scripts/backfill-project-ref-entidades.ts`
**Executor:** CEO (Benedito), em janela de manutenção
**Última atualização:** 2026-06-02

---

## 0. O que este cutover faz (e o que NÃO faz)

**Faz:**
1. Cria índices de expressão Json para resolução O(1) do handle de projeto (forward P→E e reverso E→P).
2. Cria uma `DEntidade`-espelho (`idClasse=-158`) para cada `DProject` legado que ainda não tem `dados.entidadeRefId`.
3. Reescreve as linhas `DVincula` antigas das 4 famílias project-scoped (RBAC -171/-172/-173, SPACE -188, TEAM -182, FOLDER -183) de `P` (DProject.chave) para `E` (espelho), **quando isso é seguro**.

**NÃO faz (decisão consciente — ver §6):**
- **NÃO repara vínculos com colisão histórica ambígua.** Se um valor existe TANTO em `DProject` QUANTO numa `DEntidade` não-espelho, o vínculo pode estar apontando para a entidade ERRADA (corrupção pré-existente). Esses casos vão para o **relatório de suspeitos** e exigem sua decisão. O script NÃO os toca.

**Idempotência:** rodar o script 2x não duplica espelho nem re-repara. Seguro re-executar.

---

## 1. Pré-requisitos

- Acesso ao servidor de produção com `psql` e Node.js (o mesmo onde o backend roda).
- `DATABASE_URL` apontando para o banco de produção no ambiente da shell.
- Janela de manutenção curta (o lock dos índices é breve; o backfill é por-projeto).
- Espaço em disco para o `pg_dump` das 3 tabelas.

---

## 2. BACKUP (OBRIGATÓRIO — antes de qualquer escrita)

Faça dump APENAS das 3 tabelas afetadas (DProject, DEntidade, DVincula).
Ajuste host/porta/usuário/banco conforme produção.

```bash
# Defina uma vez:
export PGHOST=<host>
export PGPORT=5432
export PGUSER=<user>
export PGDATABASE=<db>
# (senha via ~/.pgpass ou PGPASSWORD)

# Caminho do backup (registre este caminho no ticket de cutover):
export BACKUP_DIR=/var/backups/scrumban
mkdir -p "$BACKUP_DIR"
export STAMP=$(date +%Y%m%d_%H%M%S)

pg_dump \
  --table='"DProject"' \
  --table='"DEntidade"' \
  --table='"DVincula"' \
  --format=custom \
  --file="$BACKUP_DIR/preref_${STAMP}.dump"

# Verifique que o arquivo existe e tem tamanho > 0:
ls -lh "$BACKUP_DIR/preref_${STAMP}.dump"
```

> As aspas duplas em `'"DProject"'` são necessárias: os nomes de tabela são
> case-sensitive (PascalCase) no schema Devari.

---

## 3. DRY-RUN do backfill (revisar ANTES de aplicar)

O script roda em **dry-run por padrão** (nada é escrito). Rode primeiro:

```bash
cd /caminho/do/backend
npx ts-node prisma/scripts/backfill-project-ref-entidades.ts | tee "$BACKUP_DIR/dryrun_${STAMP}.log"
```

**Revise a saída:**
- `espelhos a criar` — quantos projetos legados ganharão espelho.
- `vínculos a reparar` (por idClasse) — quantas linhas DVincula serão reescritas P→E.
- **`SUSPEITOS (não reparados)`** — se > 0, leia a seção de suspeitos no log e o
  bloco JSON. **NÃO prossiga para o `--apply` sem antes decidir** o que fazer com
  cada suspeito (ver §6). Os suspeitos NÃO são reparados pelo `--apply` de
  qualquer forma — mas você precisa saber que existem.
- `erros/órfãos reais` — se > 0, há vínculos apontando para valores inexistentes
  (FK já quebrada). Investigue manualmente antes de prosseguir.

---

## 4. Aplicar a MIGRATION de índices

A migration cria dois índices de expressão Json. Ela é aditiva (sem perda de dados).

```bash
npx prisma migrate deploy
```

> **Tabelas grandes? (lock importa):** a migration usa `CREATE INDEX` simples
> (não CONCURRENTLY, porque o Prisma envolve cada migration numa transação e
> CONCURRENTLY não roda em transação). Se `DProject`/`DEntidade` forem grandes a
> ponto do lock de escrita importar, crie os índices MANUALMENTE com
> CONCURRENTLY ANTES e marque a migration como aplicada:
>
> ```sql
> CREATE INDEX CONCURRENTLY IF NOT EXISTS "DProject_dados_entidadeRefId_idx"
>   ON "DProject" (("dados" ->> 'entidadeRefId'));
> CREATE INDEX CONCURRENTLY IF NOT EXISTS "DEntidade_dados_projectId_ref_idx"
>   ON "DEntidade" (("dados" ->> 'projectId')) WHERE "idClasse" = -158;
> ```
> ```bash
> npx prisma migrate resolve --applied 20260602000000_add_project_ref_json_index
> ```

---

## 5. Aplicar o BACKFILL

Só depois do backup (§2), do dry-run revisado (§3) e da migration (§4):

```bash
npx ts-node prisma/scripts/backfill-project-ref-entidades.ts --apply | tee "$BACKUP_DIR/apply_${STAMP}.log"
```

Confira o RESUMO final: `espelhos criados`, `vínculos reparados` (por idClasse),
`SUSPEITOS` (deve bater com o dry-run), `erros` (deve ser 0).

---

## 6. Suspeitos de colisão histórica (sua decisão)

O backfill **não repara** vínculos cujo valor existe tanto em `DProject` quanto
numa `DEntidade` não-espelho. Motivo: na época em que a FK "passava por
coincidência", o vínculo pode ter sido gravado apontando para a DEntidade errada
(um usuário, org ou team cujo `chave` coincidiu com o `chave` do projeto).
Reparar automaticamente assumiria que o vínculo era "do projeto" — o que pode
estar errado e quebraria RBAC/segurança.

Para cada suspeito do relatório (campos: `vinculoChave`, `idClasse`, `campo`,
`valorAmbiguo`, `comoProjeto`, `comoEntidade`):

1. Decida, caso a caso, se o vínculo deveria apontar para o **projeto** (então
   reescreva manualmente para o espelho `E` do projeto) ou para a **DEntidade**
   real (então deixe como está / corrija).
2. Aplique a correção manual via `psql` (`UPDATE "DVincula" SET ... WHERE chave = ...`).
3. Documente cada decisão no ticket de cutover.

> Esperado em bancos pequenos/novos: **zero suspeitos** (sem histórico de
> colisão). O relatório existe para os bancos antigos onde a colisão chegou a
> acontecer.

---

## 7. Validação pós-cutover

```sql
-- (a) Todo DProject ativo tem entidadeRefId apontando para um espelho -158 vivo:
SELECT p.chave, p.nome
FROM "DProject" p
LEFT JOIN "DEntidade" e
  ON e.chave = ((p."dados" ->> 'entidadeRefId')::bigint)
 AND e."idClasse" = -158 AND e.excluido = false
WHERE p.excluido = false
  AND ((p."dados" ->> 'entidadeRefId') IS NULL OR e.chave IS NULL);
-- Esperado: 0 linhas.

-- (b) Nenhum DVincula project-scoped (não-suspeito) aponta para DProject.chave:
SELECT v.chave, v."idClasse", v."idLocEscritu", v."idEntidade"
FROM "DVincula" v
WHERE v.excluido = false
  AND v."idClasse" IN (-171,-172,-173,-188,-182,-183)
  AND (
    EXISTS (SELECT 1 FROM "DProject" p WHERE p.chave = v."idLocEscritu")
    OR EXISTS (SELECT 1 FROM "DProject" p WHERE p.chave = v."idEntidade")
  );
-- Esperado: somente os SUSPEITOS que você decidiu deixar como estão (ou 0).
```

Teste funcional: `POST /api/v1/projects` deve retornar **201** (bug do 500
fechado), criando projeto + espelho -158 + DVincula -171 apontando para `E`.

---

## 8. ROLLBACK

Se algo der errado:

```bash
# (a) Reverter os índices (manual — Prisma 5 não aplica down.sql):
psql -f prisma/migrations/20260602000000_add_project_ref_json_index/down.sql
#  (se criou com CONCURRENTLY, use DROP INDEX CONCURRENTLY)

# (b) Restaurar dados das 3 tabelas a partir do dump (§2):
#  --clean derruba as tabelas antes de recriar a partir do dump.
pg_restore --clean --if-exists \
  --table='"DProject"' --table='"DEntidade"' --table='"DVincula"' \
  --dbname="$PGDATABASE" \
  "$BACKUP_DIR/preref_${STAMP}.dump"
```

> O backfill só **ADICIONA** espelhos e **RE-APONTA** FKs existentes — o dump das
> 3 tabelas cobre a reversão integral. Nenhum dado é destruído pelo backfill.

---

## 9. Checklist de execução

- [ ] §2 Backup feito; caminho do `.dump` registrado no ticket.
- [ ] §3 Dry-run rodado e log revisado.
- [ ] §3 Suspeitos (se houver) anotados; decisões planejadas (§6).
- [ ] §4 `prisma migrate deploy` aplicado (ou CONCURRENTLY manual + resolve).
- [ ] §5 `--apply` rodado; resumo confere com o dry-run.
- [ ] §6 Suspeitos tratados manualmente (se houver) e documentados.
- [ ] §7 Queries de validação retornam o esperado; `POST /projects` = 201.
