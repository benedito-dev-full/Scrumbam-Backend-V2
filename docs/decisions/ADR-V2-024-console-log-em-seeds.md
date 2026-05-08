# ADR-V2-024 — `console.log` permitido em `prisma/seeds/**` (override ESLint)

**Status:** Aceito
**Data:** 2026-05-08
**Decisores:** Strategist (Plano F1) e Implementer (executor)
**Tags:** `#fundacao` `#pilar-3` `#seeds` `#observabilidade` `#eslint`

---

## Contexto e Problema

O padrao Devari-Core #11 (`devari-backend-patterns.md`) proibe
`console.log` em `src/**`, exigindo `Logger` do NestJS. O proposito e:
- Logs estruturados (`{ context, message, timestamp, level }`).
- Compatibilidade com sinks de producao (Datadog, CloudWatch).
- Filtro por nivel sem deploy.

O `seed-runner.ts`, porem, e **script CLI standalone** chamado por:
- `npm run seed:classes`
- `npx prisma db seed`

Roda **fora do contexto Nest** — sem `INestApplication` disponivel,
sem injection container, sem `LoggerModule`. Forcar uso de `Logger`
exigiria bootstrap minimo do Nest (~10 linhas extras), so para escrever
4 mensagens de status (`iniciando`, `OK ... classes`, `FALHA`).

---

## Alternativas Consideradas

### Alternativa A — Permitir `console.log` em `prisma/seeds/**` via override ESLint

Adicionar override em `eslint.config.js`:

```js
{
  files: ['prisma/seeds/**/*.ts'],
  rules: { 'no-console': 'off' },
},
```

E usar `// eslint-disable-next-line no-console` localizado nos sites
de uso (defesa em profundidade — caso o override seja revertido por
acidente futuro, os comentarios documentam intencao).

**Pros:**
- Simplicidade: 4 chamadas de `console.log/error` ao longo do runner.
- Padrao identico ao `templates/classes-base-template.ts:368-379` que
  usa `throw new Error(...)` com formatacao livre.
- Padrao #11 explicita escopo "**em src/**" — `prisma/seeds/**` e fora.
- Dev tem feedback imediato no terminal (sem precisar configurar Logger).

**Contras:**
- Risco de "vazamento" do padrao — alguem pode achar que vale em geral.
  Mitigado pelos comentarios localizados e pela auditoria do ESLint.

### Alternativa B — Bootstrap minimo do Nest dentro do seed-runner

Criar um `LoggerModule` standalone, instanciar via `NestFactory.createApplicationContext`,
extrair o Logger.

**Pros:**
- Padrao #11 estritamente.

**Contras:**
- ~10 linhas de overhead so para 4 mensagens.
- Complexidade desnecessaria para script CLI.
- Quebra principio de simplicidade ("simplicity > consistency for
  trivial cases").

---

## Decisao

**Adotada Alternativa A.** Override ESLint declarado em `eslint.config.js`
e comentarios `eslint-disable-next-line no-console` em cada site no
`seed-runner.ts` (defesa dupla).

---

## Consequencias

**Positivas:**
- Codigo limpo, sem bootstrap ceremonial.
- Mensagens diretas no terminal — UX previsivel.
- Padrao identico ao do template fixo Devari-Core.

**Negativas (mitigadas):**
- ESLint nao bloqueia `console.log` em `prisma/seeds/**`. Mitigado pelo
  hook Stop `validate-implementation.sh` que valida `src/` separadamente
  (linha 142+ do hook: `grep -rn "console\.log" src/`). O hook NAO inclui
  `prisma/seeds/` — o que ja era a intencao.

**Implementacao:**
- `eslint.config.js` ja inclui `prisma/seeds/**/*.ts` no array `files:`
  com regra `'no-console': ['error', { allow: ['warn', 'error'] }]`.
  Para permitir `console.log` neste contexto, este ADR formaliza o uso
  de `eslint-disable-next-line no-console` em cada site dentro de
  `seed-runner.ts`. O override de override-com-arquivo e mantido para
  sinalizacao explicita de que o uso e intencional.
- 4 comentarios `eslint-disable-next-line no-console` em
  `prisma/seeds/seed-runner.ts`.
- O hook `validate-implementation.sh` (linha 138+) verifica
  `console.log` apenas em `src/`, nao em `prisma/seeds/`.

**Auditoria periodica:**
- Reviewer verifica que `console.log` em `prisma/seeds/**` esta sempre
  acompanhado de comentario `eslint-disable` (defesa em profundidade).
- Adicao de novos arquivos em `prisma/seeds/**` herda automaticamente
  o override.
