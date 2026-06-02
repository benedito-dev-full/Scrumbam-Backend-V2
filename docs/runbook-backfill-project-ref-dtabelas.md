# Runbook — Backfill PROJECT_REF (-158) em DTabela.dEntidadeId

**ADR:** ADR-V2-058 (DEntidade-espelho `-158 PROJECT_REF` como handle canônico de projeto) + ADR-V2-059 (handle de projeto em `DTabela.dEntidadeId`)
**Fase:** passo 5 — backfill idempotente dos DADOS legados de DTabela
**Script:** `prisma/scripts/backfill-project-ref-dtabelas.ts`
**Executor:** CEO (Benedito), em janela de manutenção
**Última atualização:** 2026-06-02

> O banco de desenvolvimento aqui está **OFFLINE** — este script NÃO foi rodado
> ao vivo. O cutover (dry-run + `--apply`) é **responsabilidade do CEO**, em
> produção. O dry-run (padrão, sem `--apply`) **não escreve nada**.

---

## 0. O que este cutover faz (e o que NÃO faz)

**Faz:**
1. Cria uma `DEntidade`-espelho (`idClasse=-158`) para cada `DProject` legado que ainda não tem `dados.entidadeRefId` (Fase A — idêntica ao backfill de DVincula; idempotente).
2. Reescreve as linhas `DTabela` antigas das classes **project-scoped** de `P` (DProject.chave) para `E` (espelho -158), **quando isso é seguro**.

Classes project-scoped reparadas (Fase B):

| Família       | idClasse                          | Escopo do `dEntidadeId` |
|---------------|-----------------------------------|-------------------------|
| Statuses V3   | -440 (agrupador) + -441..-449     | projeto                 |
| Sprint        | -400                              | projeto                 |
| Priorities    | -420 (agrupador) + -421..-424     | projeto                 |
| Task type     | -430                              | projeto                 |
| Webhooks      | -470                              | projeto                 |

**NÃO faz (decisão consciente — ver §6):**
- **NÃO toca classes cujo `dEntidadeId` é uma DEntidade REAL.** Ficam de fora por filtro de idClasse e nunca devem ser adicionadas à lista do script:
  - **API Keys -471** → `dEntidadeId = userId` (DEntidade real)
  - **MCP Keys -472** → `dEntidadeId = userId` (DEntidade real)
  - **ISSUE_COUNTER -475** → `dEntidadeId = teamId` (DEntidade -180 real)
  - **Catálogos globais** → `dEntidadeId = NULL`
- **NÃO repara registros ambíguos/anômalos.** Se o valor existir TANTO em `DProject` QUANTO numa `DEntidade` não-espelho (ou apontar para DEntidade não-espelho numa classe project-scoped), vai para o **relatório de suspeitos** e exige sua decisão. O script NÃO os toca.

**Idempotência:** rodar o script 2x não duplica espelho nem re-repara. Seguro re-executar.

---

## 1. Pré-requisitos

- Acesso ao servidor de produção com `psql` e Node.js (o mesmo onde o backend roda).
- `DATABASE_URL` apontando para o banco de produção no ambiente da shell.
- Janela de manutenção curta (o backfill é por-projeto / por-linha).
- Espaço em disco para o `pg_dump` das 3 tabelas.
- **(Recomendado)** Ter rodado antes o backfill de DVincula
  (`backfill-project-ref-entidades.ts`). Não é obrigatório — este script replica a
  Fase A e cria os espelhos sozinho, de forma idempotente — mas rodar o de
  DVincula primeiro deixa os espelhos prontos e reduz a Fase A deste a um no-op.

---

## 2. BACKUP (OBRIGATÓRIO — antes de qualquer escrita)

Faça dump APENAS das 3 tabelas afetadas (DProject, DEntidade, DTabela).
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
  --table='"DTabela"' \
  --format=custom \
  --file="$BACKUP_DIR/preref_dtabela_${STAMP}.dump"

# Verifique que o arquivo existe e tem tamanho > 0:
ls -lh "$BACKUP_DIR/preref_dtabela_${STAMP}.dump"
```

> As aspas duplas em `'"DTabela"'` são necessárias: os nomes de tabela são
> case-sensitive (PascalCase) no schema Devari.

---

## 3. DRY-RUN do backfill (revisar ANTES de aplicar)

O script roda em **dry-run por padrão** (nada é escrito). Rode primeiro:

```bash
cd /caminho/do/backend
npx ts-node prisma/scripts/backfill-project-ref-dtabelas.ts | tee "$BACKUP_DIR/dryrun_dtabela_${STAMP}.log"
```

**Revise a saída:**
- `espelhos a criar` — quantos projetos legados ganharão espelho (deve ser 0 se o
  backfill de DVincula já rodou).
- `DTabelas a reparar` (por idClasse) — quantas linhas DTabela serão reescritas P→E.
- **`SUSPEITOS (não reparados)`** — se > 0, leia a seção de suspeitos no log e o
  bloco JSON. **NÃO prossiga para o `--apply` sem antes decidir** o que fazer com
  cada suspeito (ver §6). Os suspeitos NÃO são reparados pelo `--apply` de
  qualquer forma — mas você precisa saber que existem.
- `erros/órfãos reais` — se > 0, há DTabelas apontando para valores inexistentes
  (FK já quebrada). Investigue manualmente antes de prosseguir.

> **Ordem recomendada:** rode o backfill de DVincula
> (`backfill-project-ref-entidades.ts`) ANTES deste, para que os espelhos já
> existam. Se ainda não rodou, este script os cria na Fase A — sem problema.

---

## 4. Aplicar o BACKFILL

Só depois do backup (§2) e do dry-run revisado (§3):

```bash
npx ts-node prisma/scripts/backfill-project-ref-dtabelas.ts --apply | tee "$BACKUP_DIR/apply_dtabela_${STAMP}.log"
```

Confira o RESUMO final: `espelhos criados`, `DTabelas reparadas` (por idClasse),
`SUSPEITOS` (deve bater com o dry-run), `erros` (deve ser 0).

> Não há migration de schema neste passo — os índices de expressão Json já foram
> criados no passo 3 do ADR-V2-058 (ver `runbook-backfill-project-ref-entidades.md` §4).

---

## 5. Suspeitos de colisão histórica (sua decisão)

O backfill **não repara** registros DTabela cujo `dEntidadeId`:
- existe tanto em `DProject` quanto numa `DEntidade` não-espelho (`ambiguo`), ou
- aponta para uma `DEntidade` não-espelho numa classe project-scoped (`entidade`
  — anômalo: nessas classes o esperado é sempre um projeto).

Motivo: na época em que a FK "passava por coincidência", o registro pode ter sido
gravado apontando para a DEntidade errada (um usuário, org ou team cujo `chave`
coincidiu com o `chave` do projeto). Reparar automaticamente assumiria que era "do
projeto" — o que pode estar errado e quebraria o escopo de statuses/sprint/etc.

Para cada suspeito do relatório (campos: `tabelaChave`, `idClasse`, `campo`,
`valorAmbiguo`, `comoProjeto`, `comoEntidade`):

1. Decida, caso a caso, se a DTabela deveria apontar para o **projeto** (então
   reescreva manualmente para o espelho `E` do projeto) ou se o registro está
   correto / deve ser arquivado.
2. Aplique a correção manual via `psql` (`UPDATE "DTabela" SET "dEntidadeId" = ... WHERE chave = ...`).
3. Documente cada decisão no ticket de cutover.

> Esperado em bancos pequenos/novos: **zero suspeitos** (sem histórico de
> colisão). O relatório existe para os bancos antigos onde a colisão chegou a
> acontecer.

---

## 6. Validação pós-cutover

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

-- (b) Nenhuma DTabela project-scoped (não-suspeita) aponta para DProject.chave:
SELECT t.chave, t."idClasse", t."dEntidadeId"
FROM "DTabela" t
WHERE t.excluido = false
  AND t."idClasse" IN (-440,-441,-442,-443,-444,-445,-446,-447,-448,-449,
                       -400,-420,-421,-422,-423,-424,-430,-470)
  AND t."dEntidadeId" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "DProject" p WHERE p.chave = t."dEntidadeId");
-- Esperado: somente os SUSPEITOS que você decidiu deixar como estão (ou 0).

-- (c) As classes FORA de escopo NÃO foram tocadas (sanity — devem continuar
--     apontando para DEntidade real):
SELECT t."idClasse", count(*) AS linhas
FROM "DTabela" t
WHERE t.excluido = false AND t."idClasse" IN (-471,-472,-475)
GROUP BY t."idClasse";
-- Esperado: contagem inalterada vs. antes do cutover.
```

Teste funcional: leitura/escrita de statuses, sprint, priorities e webhooks de um
projeto legado deve funcionar (a FK `DTabela.dEntidadeId` agora resolve para o
espelho `-158`, não para `DProject.chave`).

---

## 7. ROLLBACK

Se algo der errado, restaure as 3 tabelas a partir do dump (§2):

```bash
#  --clean derruba as tabelas antes de recriar a partir do dump.
pg_restore --clean --if-exists \
  --table='"DProject"' --table='"DEntidade"' --table='"DTabela"' \
  --dbname="$PGDATABASE" \
  "$BACKUP_DIR/preref_dtabela_${STAMP}.dump"
```

> O backfill só **ADICIONA** espelhos e **RE-APONTA** FKs existentes — o dump das
> 3 tabelas cobre a reversão integral. Nenhum dado é destruído pelo backfill.

---

## 8. Checklist de execução

- [ ] §1 (recomendado) Backfill de DVincula já rodado.
- [ ] §2 Backup feito; caminho do `.dump` registrado no ticket.
- [ ] §3 Dry-run rodado e log revisado.
- [ ] §3 Suspeitos (se houver) anotados; decisões planejadas (§5).
- [ ] §4 `--apply` rodado; resumo confere com o dry-run.
- [ ] §5 Suspeitos tratados manualmente (se houver) e documentados.
- [ ] §6 Queries de validação retornam o esperado; (c) confirma -471/-472/-475 intactas.
