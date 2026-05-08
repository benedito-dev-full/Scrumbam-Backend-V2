# ADR-V2-020 — Idempotencia do seed via UPSERT atomico em transacao

**Status:** Aceito
**Data:** 2026-05-08
**Decisores:** Strategist (Plano F1) e Implementer (executor)
**Tags:** `#fundacao` `#pilar-3` `#seeds` `#idempotencia`

---

## Contexto e Problema

O seed de DClasses precisa ser **idempotente** — `npm run seed:classes`
ou `npx prisma db seed` rodando varias vezes deve produzir o mesmo
estado final (128 linhas em `DClasse`, sem duplicatas, sem erros).
Idempotencia e exigida por:
- Hooks de CI que rodam o seed em cada deploy.
- Containers efemeros que recriam o banco e replicam o seed.
- Reseed apos drift de dados (alguem alterou um nome via UI por engano).

A questao operacional: qual estrategia de escrita?

---

## Alternativas Consideradas

### Alternativa A — `prisma.dClasse.upsert` por chave em `$transaction`

Para cada classe, `upsert({ where: { chave }, create: data, update: data })`
dentro de `prisma.$transaction(async (tx) => { ... })`.

**Pros:**
- 1 round-trip por classe — total <2s para 128 classes em Postgres local.
- **Idempotencia forte:** `update: data` espelha `create: data` — re-seed
  detecta e corrige drift (campos editaveis voltam ao canonico).
- **Atomicidade total:** se um upsert falha, transacao da rollback —
  estado final = 0 ou N, nunca parcial.
- Codigo simples (1 loop, 1 upsert, 1 transaction).

**Contras:**
- `update: data` sobrescreve mudancas runtime de campos editaveis. Mitigado
  porque seed declara `editavel: false` em todas as 128 classes (nenhuma
  e editavel via UI).

### Alternativa B — `findFirst` + `create` se ausente, ignorar se presente

**Pros:**
- Nunca sobrescreve.
- Mais "seguro" se alguem editar manualmente.

**Contras:**
- 2 round-trips por classe (slow em CI: 256 round-trips em vez de 128).
- Drift fica invisivel (campo alterado nunca volta ao canonico).
- Viola idempotencia forte (estado pode divergir entre execucoes).

### Alternativa C — `createMany({ skipDuplicates: true })` em lote unico

**Pros:**
- 1 query total (mais rapido).

**Contras:**
- `skipDuplicates` **ignora updates** necessarios — perde idempotencia forte.
- `createMany` no Prisma nao suporta UPDATE — drift fica perpetuo.
- Em multi-DB pode comportar-se diferente (Postgres vs MySQL).

---

## Decisao

**Adotada Alternativa A.** UPSERT por chave em `prisma.$transaction`,
implementada em `prisma/seeds/seed-runner.ts:applyCanonicalSeed`.

```ts
await prisma.$transaction(async (tx) => {
  for (const c of classes) {
    await tx.dClasse.upsert({
      where: { chave: BigInt(c.chave) },
      create: data,
      update: data,
    });
  }
});
```

---

## Consequencias

**Positivas:**
- Drift detection automatico — re-seed corrige mudancas manuais indevidas.
- All-or-nothing: nunca sobra estado parcial em caso de falha.
- Compatibilidade total com ambientes efemeros (Docker, CI).
- 1ª execucao: 128 upserts em ~948ms. 2ª execucao: ~149ms (puro UPDATE).

**Negativas (mitigadas):**
- Sobrescreve mudancas manuais em campos seed — esperado e desejavel
  porque DClasses sao **taxonomia**, nao dados de usuario; mudancas devem
  ir via novo seed + ADR, nunca via UI.

**Implementacao:**
- `prisma/seeds/seed-runner.ts` (`applyCanonicalSeed`).
- Tratamento de `tableFields = null` via `Prisma.JsonNull` (Prisma 5+
  distingue SQL NULL de JSON `null`).
- Modo `--dry-run` (env `SEED_DRY_RUN=true`) para CI offline / smoke local
  sem Postgres — valida import + contagens, nao toca o banco.
