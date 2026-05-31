# Plano de Correção — Tasks órfãs após deletar a task-mãe

**Data:** 2026-05-30
**Autor do diagnóstico:** investigação a partir do frontend (Scrumbam-Frontend-V2)
**Repositório alvo:** `Scrumbam-Backend-V2`
**Severidade:** Média-Alta (dados "fantasma" persistem e aparecem em todas as views)
**Status:** DRAFT — aguardando decisão de rota (ver §6)

---

## 0. Para quem está lendo isto pela primeira vez

Você não precisa conhecer o histórico. Este documento é autocontido.
Ele descreve **um bug de dados**, **prova onde ele está** (arquivo + linha +
trecho de código real), e **propõe 3 soluções** com prós/contras. Ao final
você decide a rota e tem o passo-a-passo.

**Glossário mínimo (3 termos):**

| Termo | O que é |
|-------|---------|
| `DTask` | A tabela de tarefas (Prisma). Toda task, fase e bloco é uma `DTask`. |
| `idPai` | Coluna de auto-referência: a task-filha aponta para a `chave` da task-mãe. É a hierarquia (subtarefas / fases). |
| `idClasse` | Discrimina o "tipo" da DTask. `-154` = TASK normal, `-200` = PHASE (fase/bloco). |
| `excluido` | Flag de soft-delete. `true` = deletada (não aparece nas listagens). Nada é apagado fisicamente. |

---

## 1. O sintoma (o que o usuário vê)

1. O usuário criou tarefas com **subtarefas** (mãe → filhas via `idPai`).
2. O usuário **deletou as tarefas-mãe** (TASKs normais, não fases).
3. **As filhas continuaram aparecendo** nas listagens (no caso, na nova view
   de Blocos do frontend, no grupo "Sem bloco" — mas o problema é geral: elas
   aparecem em **qualquer** listagem do projeto, inclusive Lista e Kanban).

Em outras palavras: deletar a mãe **não deletou as filhas**, e as filhas
viraram **órfãs vivas** (registros com `excluido=false` cujo `idPai` aponta
para uma mãe com `excluido=true`).

> ⚠️ Importante: **a culpa NÃO é do frontend.** O frontend lista exatamente o
> que `GET /tasks` retorna. As órfãs estão vivas no banco e a API as devolve.
> A correção é 100% backend.

---

## 2. A causa-raiz (com provas)

São **dois problemas independentes** que, somados, produzem o sintoma.
Cada um está num arquivo específico. Abra os arquivos e confirme.

### Problema A — o DELETE não cascateia para TASKs normais

**Arquivo:** `src/tasks/tasks.service.ts`
**Método:** `delete(id, accessibleProjectIds?, options?)`
**Linhas:** 1297–1298

```ts
const isPhase = existing.idClasse === ID_CLASSE_PHASE;          // -200
const cascade = options?.cascade !== undefined ? options.cascade : isPhase;
```

A decisão de cascatear depende de a task ser uma **PHASE** (`idClasse=-200`).
- Deletou uma **PHASE** → `isPhase=true` → cascade liga → filhas deletadas. ✅
- Deletou uma **TASK normal** (`idClasse=-154`) com filhas → `isPhase=false`
  → **cascade NÃO liga** → as filhas ficam intactas e órfãs. ❌

Isso está inclusive **documentado como intencional** no JSDoc do método
(linhas 1250–1252):

```
 * - `false`: soft-delete somente da task; descendentes ficam orfaos
 *   (`idPai` aponta para task deletada — comportamento intencional para
 *   cenarios de "desvincular" sem destruir).
```

Ou seja: o comportamento atual foi **desenhado pensando só em fases**. Para
TASK normal com subtarefas, ninguém decidiu o que deveria acontecer — e o
default (não cascatear) gera órfã.

### Problema B — o endpoint nunca pede cascade

**Arquivo:** `src/tasks/tasks.controller.ts`
**Método:** `delete(@Param('id') id, @Request() req)`
**Linhas:** 390–399

```ts
@Delete(':id')
@HttpCode(HttpStatus.NO_CONTENT)
async delete(@Param('id') id: string, @Request() req: JwtRequest): Promise<void> {
  const allowed = await this.resolveScopedProjectIds(req);
  await this.tasksService.delete(id, allowed);   // ← não passa options.cascade
}
```

O controller chama `delete(id, allowed)` **sem** o 3º parâmetro (`options`).
Então o service cai no default do Problema A. Não há nem como o cliente
solicitar cascade hoje — o endpoint não expõe esse controle.

### Problema C — a listagem não esconde órfãs

**Arquivo:** `src/tasks/tasks.service.ts`
**Método:** `findMany(query, accessibleProjectIds)`
**Linhas:** 530–536

```ts
const where: Prisma.DTaskWhereInput = {
  excluido: false,
  idProject: { in: scopedProjectIds },
  ...(query.assigneeId ? { idAssignee: BigInt(query.assigneeId) } : {}),
  ...(query.sprintId ? { idSprint: BigInt(query.sprintId) } : {}),
  ...(query.cursor ? { chave: { lt: BigInt(query.cursor) } } : {}),
};
```

O único filtro de "vivacidade" é `excluido: false` **na própria task**. Não
há nenhuma verificação de que **o pai** (`idPai`) ainda está vivo. Logo, uma
órfã (filha viva, pai morto) passa no filtro e é retornada normalmente.

> Este problema é secundário: se A+B forem corrigidos, novas órfãs não
> nascem. Mas C explica por que as órfãs **já existentes** aparecem, e é
> relevante decidir se queremos uma rede de proteção na leitura.

---

## 3. A boa notícia: a solução de cascade JÁ EXISTE no código

Não é preciso escrever lógica de cascade do zero. Já existe um método pronto,
**testado**, que faz exatamente isto — e ele cascateia por `idPai`
**independente de ser fase ou não**.

**Arquivo:** `src/tasks/services/phase-hierarchy.service.ts`
**Método:** `softDeleteCascade(taskId)`
**Linhas:** 189–213

```ts
async softDeleteCascade(taskId: bigint): Promise<{ affected: number }> {
  const result = await this.prisma.$executeRaw`
    WITH RECURSIVE descendants AS (
      SELECT chave, 0 AS depth
      FROM "DTask"
      WHERE chave = ${taskId} AND excluido = false
      UNION ALL
      SELECT t.chave, d.depth + 1
      FROM "DTask" t
      INNER JOIN descendants d ON t."idPai" = d.chave
      WHERE t.excluido = false AND d.depth < 20
    )
    UPDATE "DTask"
    SET excluido = true, "atualizadoEm" = NOW()
    WHERE chave IN (SELECT chave FROM descendants)
  `;
  return { affected: Number(result) };
}
```

Pontos a notar:
- É **uma única statement** (CTE recursiva no PostgreSQL) — sem N+1, sem loop.
- Cascateia por `idPai` para qualquer tipo de DTask — **a fase nunca aparece
  na cláusula**; o filtro é puramente `idPai`. Funciona igual para TASK normal.
- Tem **guardrail de profundidade** (`d.depth < 20`) contra árvores patológicas.
- Já é coberto por testes: `src/tasks/services/__tests__/phase-hierarchy.service.spec.ts`
  (5 casos: folha, 1 nível, multi-nível, já excluída, inexistente).

Tradução: o `delete()` do service **já chama** `softDeleteCascade` quando
`cascade=true` (linha 1301). O problema é só **quando** ele decide passar
`cascade=true`.

---

## 4. Os 3 problemas em uma frase cada

| # | Problema | Arquivo | Linha |
|---|----------|---------|-------|
| A | Cascade só liga para PHASE; TASK normal com filhas não cascateia | `src/tasks/tasks.service.ts` | 1297–1298 |
| B | Endpoint DELETE não expõe nem usa `cascade` | `src/tasks/tasks.controller.ts` | 390–399 |
| C | Listagem retorna órfãs (não filtra por pai vivo) | `src/tasks/tasks.service.ts` | 530–536 |

E a ferramenta de solução (já pronta): `softDeleteCascade` em
`src/tasks/services/phase-hierarchy.service.ts:189`.

---

## 5. Soluções propostas

São complementares: lidam com prevenção (futuro), limpeza (passado) e
proteção (leitura). Você não precisa fazer as três — ver §6.

### Solução 1 — Cascade por padrão ao deletar QUALQUER task com filhas (PREVENÇÃO)

**O que muda:** ao deletar uma task, cascatear para os descendentes
independente de ela ser PHASE ou TASK normal.

**Onde:** `src/tasks/tasks.service.ts`, método `delete`, linha 1298.

**Como (mínimo):**
```ts
// Antes:
const cascade = options?.cascade !== undefined ? options.cascade : isPhase;

// Depois (default = sempre cascatear; respeitando override explícito):
const cascade = options?.cascade !== undefined ? options.cascade : true;
```

**Trade-off / atenção:**
- Muda comportamento **documentado como intencional** (o "desvincular sem
  destruir" das linhas 1250–1252). Se algum fluxo dependia de deletar a mãe e
  manter as filhas vivas, ele quebra. **Verificar antes** se existe esse
  consumidor (buscar chamadas a `.delete(` que esperem órfã).
- Como `softDeleteCascade` é soft-delete (`excluido=true`), é **reversível** —
  o risco é menor que um DELETE físico.

**Variante mais conservadora (recomendada se houver medo de regressão):**
expor `cascade` no endpoint (Solução 1b) e deixar o **cliente** decidir, em
vez de mudar o default globalmente.

### Solução 1b — Expor `cascade` no endpoint DELETE (CONTROLE EXPLÍCITO)

**Onde:** `src/tasks/tasks.controller.ts`, linhas 390–399.

**Como:**
```ts
@Delete(':id')
@HttpCode(HttpStatus.NO_CONTENT)
async delete(
  @Param('id') id: string,
  @Query('cascade') cascade: string | undefined,   // ?cascade=true|false
  @Request() req: JwtRequest,
): Promise<void> {
  const allowed = await this.resolveScopedProjectIds(req);
  const cascadeBool = cascade === undefined ? undefined : cascade === 'true';
  await this.tasksService.delete(id, allowed, { cascade: cascadeBool });
}
```

O service **já aceita** `options.cascade` (linha 1273) — só não recebia.
O frontend então passa `?cascade=true` ao deletar uma mãe.

**Trade-off:** não muda default (zero risco de regressão), mas exige o
frontend mandar o parâmetro. Decisão de cascade vira responsabilidade do
cliente, o que pode ser bom (UX: "deletar também as subtarefas?") ou ruim
(cliente esquece e gera órfã de novo).

### Solução 2 — Limpar as órfãs que JÁ existem (CORREÇÃO DO PASSADO)

As Soluções 1/1b previnem **novas** órfãs, mas não tocam nas que já estão no
banco (as ~34 que o usuário está vendo agora). Para essas:

**Opção 2a — Script idempotente (recomendado):** um script que marca
`excluido=true` em toda task viva cujo pai está excluído.

```sql
-- Diagnóstico primeiro (quantas órfãs existem):
SELECT COUNT(*) FROM "DTask" filha
JOIN "DTask" pai ON filha."idPai" = pai.chave
WHERE filha.excluido = false AND pai.excluido = true;

-- Correção (rodar em transação, conferir count antes/depois):
UPDATE "DTask" filha
SET excluido = true, "atualizadoEm" = NOW()
FROM "DTask" pai
WHERE filha."idPai" = pai.chave
  AND filha.excluido = false
  AND pai.excluido = true;
```

> Atenção: isto pega **1 nível**. Se houver órfãs em cadeia (filha de filha),
> rodar repetidamente até `affected=0`, OU usar uma CTE recursiva. Para o
> volume atual (poucas dezenas), rodar 2–3× é suficiente e seguro.

**Opção 2b — Reaproveitar `softDeleteCascade`:** escrever um script que
itera as mães já deletadas e chama `softDeleteCascade` em cada. Mais código,
mas reusa a lógica testada. Provavelmente overkill para um one-shot.

### Solução 3 — Filtrar órfãs na listagem (REDE DE PROTEÇÃO NA LEITURA)

**Onde:** `src/tasks/tasks.service.ts`, `findMany`, linha 530.

**Ideia:** a listagem deixar de retornar tasks cujo pai está excluído, mesmo
que a órfã ainda exista no banco.

**Trade-off:**
- ✅ Esconde o sintoma imediatamente, mesmo sem rodar o script de limpeza.
- ❌ A órfã continua **viva** no banco (inconsistência latente; pode reaparecer
  em outra query que não tenha o filtro). É band-aid, não cura.
- ⚠️ Custo de query: filtrar por "pai vivo" exige um JOIN/subquery; avaliar
  impacto no plano de execução (a listagem é hot path).

**Recomendação:** só fazer a 3 se quiser proteção defensiva. Se A/1b + 2 forem
aplicadas, a 3 é opcional.

---

## 6. Decisão de rota (o que eu recomendo)

A combinação **mínima e correta**, sem mexer em comportamento sensível à toa:

1. **Solução 1b** (expor `cascade` no endpoint) — controle explícito, zero
   regressão. O frontend passa `?cascade=true` ao deletar mãe.
   *(Alternativa mais agressiva: Solução 1, mudar o default — só se confirmado
   que nenhum fluxo depende do "desvincular sem destruir".)*
2. **Solução 2a** (script SQL idempotente) — limpa as órfãs já existentes.
3. **Solução 3** — **adiar** (só se quiser rede extra de proteção).

> Por que não mudar o default (Solução 1) de cara: o JSDoc diz que o
> não-cascade é intencional. Mudar default sem auditar consumidores é o tipo
> de coisa que "flutua" e gera regressão silenciosa. 1b é reversível e
> explícito — mais seguro para um plano de backend.

---

## 7. Checklist de implementação (rota recomendada)

- [ ] **Auditar** se há consumidor que depende de deletar mãe e manter filha
      viva (buscar usos de `.delete(` no backend; checar testes de delete).
- [ ] **Solução 1b:** adicionar `@Query('cascade')` no controller
      (`tasks.controller.ts:390`) e repassar ao service.
- [ ] **Frontend:** ao deletar task com subtarefas, chamar `DELETE /tasks/:id?cascade=true`
      (ou perguntar ao usuário). *(Tarefa do repo frontend, fora deste plano.)*
- [ ] **Solução 2a:** rodar o `SELECT` de diagnóstico em produção/staging para
      contar as órfãs.
- [ ] Rodar o `UPDATE` de limpeza **em transação**, conferindo count antes/depois.
      Repetir até `affected=0` (caso de cadeia).
- [ ] **Testes:** adicionar caso em `tasks.service.spec.ts` cobrindo "delete de
      TASK normal com filhas via `cascade=true` marca filhas como excluídas".
- [ ] **Regressão:** confirmar que deletar PHASE continua cascateando (default
      atual preservado).
- [ ] **Validar:** `npm run build`, `npm run test`, lint — 0 erros.

---

## 8. Arquivos citados (índice rápido)

| Arquivo | Papel no problema |
|---------|-------------------|
| `src/tasks/tasks.service.ts:1270` (`delete`) | Problema A (decisão de cascade) |
| `src/tasks/tasks.service.ts:1297-1298` | A linha exata do default que gera órfã |
| `src/tasks/tasks.service.ts:1250-1252` (JSDoc) | Onde o não-cascade está documentado como intencional |
| `src/tasks/tasks.controller.ts:390-399` (`delete`) | Problema B (endpoint não pede cascade) |
| `src/tasks/tasks.service.ts:492` (`findMany`), linhas 530-536 | Problema C (listagem retorna órfãs) |
| `src/tasks/services/phase-hierarchy.service.ts:189` (`softDeleteCascade`) | A solução que JÁ existe e está testada |
| `src/tasks/services/__tests__/phase-hierarchy.service.spec.ts:210` | Testes do cascade |

---

**Resumo de uma linha para o dev do backend:** *Deletar uma TASK normal não
cascateia para as subtarefas (só PHASE cascateia — `tasks.service.ts:1298`), e
a listagem não filtra filhas órfãs (`findMany`, linha 530). O cascade pronto e
testado já existe (`softDeleteCascade`, `phase-hierarchy.service.ts:189`) — só
precisa ser acionado. Expor `?cascade` no DELETE + script SQL para limpar as
órfãs atuais resolve.*
