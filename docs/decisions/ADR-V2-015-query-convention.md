# ADR-V2-015 — Convencao de Query Parameters: `?idClasse=N` (numerica) e canonica do V2

**Status:** Aceito
**Data:** 2026-05-08
**Decisores:** Strategist (Bloco 3 — Dominio + Engine), revisado por Conversa Principal
**Tags:** `#fundacao` `#endpoints-genericos` `#contrato-http` `#pilar-2`

---

## Contexto e Problema

A auditoria PARTE-1 vs Plano V2 (`docs/auditoria/AUDITORIA-PARTE-1-vs-PLANO-V2.md` topico [48], score 4/10) identificou uma **divergencia silenciosa** entre o que o template canonico do Devari Core usa e o que o plano V2 padronizou.

A `RELATORIO-DEVARI-PARTE-1-BACKEND-CORE.md` linha 1376 documenta explicitamente que o `TabelaController` real do Devari Core hoje usa **`?classe=NOME`** (string com o codigo da DClasse: `?classe=STATUS`, `?classe=SPRINT`).

Mas os planos V2 usam consistentemente **`?idClasse=N`** numerica:
- `01-FUNDACAO.md` linha 283: `GET /tabelas?idClasse=-440`
- `02-DOMINIO-ENGINE.md` linha 478: `GET /tabelas?idClasse=-400&dEntidadeId=$PROJ`
- `02-DOMINIO-ENGINE.md` linha 482: `GET /tabelas?idClasse=-440&dEntidadeId=$PROJ`

Pior: ha **inconsistencia interna** — o smoke test em `01-FUNDACAO.md` linha 617 usa `classe=STATUS` (string) ao mesmo tempo que linha 283 usa `idClasse=-440` (numerica). Sem decisao explicita, F2 vai implementar uma das duas formas, F14 (paridade golden) vai detectar divergencia, e havera retrabalho.

A questao **precisa ser resolvida ANTES da F2** porque define o contrato HTTP do `TabelaController` (e por consistencia dos demais controllers genericos do Pilar 2).

---

## Alternativas Consideradas

### Opcao A — Seguir o template canonico: `?classe=NOME` (string)

**Pros:**
- Coerente com o que o Devari Core ja faz hoje (`RELATORIO-DEVARI-PARTE-1` linha 1376).
- Legibilidade humana melhor em logs/monitoramento (`?classe=SPRINT` vs `?idClasse=-400`).
- Menor acoplamento entre cliente e seed (cliente nao precisa saber o numero — basta o nome).
- Permite refatorar/renumerar classes negativas sem quebrar o cliente.

**Contras:**
- Obriga lookup `nome -> idClasse` em **toda** request (cache mitiga).
- Menos type-safe: erros de digitacao no nome (`?classe=SPRNT`) so explodem em runtime.
- Performance: filtro por coluna `codigo` (texto) e levemente mais lento que por `chave` (BigInt indexado) — diferenca real <1ms na maioria dos casos, mas existe.
- Quebra contrato direto com o seed do projeto (que usa numeros).

### Opcao B — Padronizar `?idClasse=N` (numerica)

**Pros:**
- Type-safe e explicito (numero indexado direto na FK).
- Performance otima (indice numerico em `chave`).
- Coerente com a logica interna do sistema (TODA query Prisma do plano usa `BigInt(-N)`).
- Frontend Scrumban V1 ja usa `idClasse` em varias chamadas — alinha legado e V2.
- ZERO ambiguidade — sem necessidade de lookup nome->id em runtime.

**Contras:**
- DIVERGE do template canonico Devari Core (`RELATORIO-DEVARI-PARTE-1` linha 1376).
- Quebra cliente que esteja chamando `?classe=NOME` direto (poucos esperados; legado nao tem cliente externo direto na API generica de `/tabelas`).
- Menos auto-explicativo em logs (`-400` vs `SPRINT`).

### Opcao C — Aceitar AMBOS (compatibilidade dupla)

**Pros:**
- Zero quebra de compatibilidade.
- Cliente legado e novo coexistem.
- Migracao gradual.

**Contras:**
- Codigo de wrapper e branching (`if (query.idClasse) ... else if (query.classe) ...`) em todo controller generico.
- Manutencao dupla (testes para os 2 caminhos, paridade golden testa os 2).
- Manter para sempre vs deprecar — sem disciplina, "compat temporaria" vira permanente.

---

## Decisao

**Escolhemos a Opcao B com ponte de compatibilidade controlada (sub-versao da Opcao C):**

1. **`?idClasse=N` (numerica) e a convencao oficial do V2** em todos os endpoints genericos do Pilar 2 (`/entidades`, `/tabelas`, `/classes`).

2. **Aceitar `?classe=NOME` (string) como ALIAS DEPRECATED nas primeiras 2 sprints** (~4 semanas) atraves de wrapper de compatibilidade no service:
   - Se request enviar `classe=NOME`: service faz lookup interno (com cache LRU 5min de `codigo -> chave`) e converte para `idClasse=N` antes da query principal.
   - Para CADA request usando `?classe=NOME`, emitir `Logger.warn('deprecation: ?classe=NOME deprecated, use ?idClasse=N. Caller=<userAgent|orgId>')`.
   - Adicionar header de resposta `Deprecation: true` + `Sunset: <data 2 sprints>` (RFC 8594).

3. **Apos 2 sprints (timeline registrada em F14 hardening):**
   - O wrapper de compatibilidade sera removido.
   - Logs de deprecation servem como auditoria de "quem ainda chama assim" — F14 fecha o pendulo apenas se logs do ultimo sprint estao zerados.
   - Decisao de rollback: se houver caller legitimo nao migravel, transformar wrapper em permanente via novo ADR.

4. **Frontend Scrumban V2 (Scrumbam-FrontEnd) deve usar `?idClasse=N` desde o dia 1** — o wrapper existe APENAS para cobrir clientes externos eventuais e o paridade golden test contra V1 durante migration (F15).

5. **F14 paridade golden** testa **AMBAS as formas** durante o periodo de compat — garante que a saida e identica.

---

## Justificativa

- A V2 e refundacao canonica, nao manutencao incremental (`00-PLANO-MESTRE.md` 0.1). Aceitar a divergencia silenciosa do template propaga divida.
- Type safety ganha em `idClasse` (BigInt direto) reduz uma classe inteira de bugs (typo em codigo) e e coerente com **TODOS** os outros 21 padroes de `devari-backend-patterns.md` (BigInt para IDs, sem strings em where clauses, etc.).
- A ponte de compat (2 sprints) zera risco de quebrar cliente esquecido, sem virar divida permanente — sunset documentado, logs auditados, removido em F14.
- A divergencia em relacao ao template Devari Core e **consciente e documentada aqui** — nao silenciosa. O proprio Devari Core devera evoluir nessa direcao em sua proxima refatoracao (issue separado para o template raiz).

---

## Consequencias

### Positivas
- Contrato HTTP do V2 e type-safe e numericamente correto desde o dia 1.
- Frontend e backend falam a mesma linguagem (numeros = chaves BigInt indexadas).
- Performance otima das queries genericas (`WHERE idClasse = $1` direto, sem JOIN com `codigo`).
- Logs de deprecation dao visibilidade objetiva sobre quem precisa migrar.

### Negativas
- Implementer precisa codar wrapper de compat no `TabelaService.findManyByClasse` e `EntidadeService.findManyByClasse` (estimado: ~30 linhas + cache LRU + logging — overhead aceitavel).
- F14 paridade golden tem 2 cenarios em vez de 1 (ambos `idClasse=N` e `classe=NOME`) durante o periodo de compat.
- Frontend Scrumban V1 que chame `?classe=NOME` (rara situacao) precisa migrar — auditavel via logs de deprecation.
- Devari Core (template raiz) fica formalmente divergente do V2 ate que tambem migre — risco aceitavel porque V2 esta evoluindo o template em outras frentes (17 tabelas vs 14, DVFS ativo, etc.).

### Impacto direto nas fases

- **F2 (Endpoints Genericos):**
  - `EntidadeController` e `TabelaController` aceitam `?idClasse=N` (canonico).
  - Wrapper de compat para `?classe=NOME` no service correspondente, com:
    - Cache LRU `codigo -> chave` (TTL 5min, max 200 entradas).
    - `Logger.warn('deprecation: ...')` por hit.
    - Header `Deprecation: true` + `Sunset: <ISO date 2 sprints>` na resposta.
  - DTO `ListEntidadeQueryDto` e `ListTabelaQueryDto` declaram **ambos** os campos com `@IsOptional()`, validacao mutuamente exclusiva via `@ValidateIf` (rejeitar se vier os dois).
- **F14 (Hardening):**
  - Paridade golden test inclui 2 cenarios para o periodo de compat (`?idClasse=-400` e `?classe=SPRINT`).
  - DoD acrescenta item: "Logs do ultimo sprint nao mostram nenhum hit de `?classe=NOME` antes de remover wrapper."
  - Se logs zerados: PR remove wrapper + tests de compat. Se nao zerados: novo ADR re-avalia.
- **F15 (Migration):** O migrator de dados nao usa esses endpoints — usa Prisma direto. Sem impacto.

---

## Referencias

- `RELATORIO-DEVARI-PARTE-1-BACKEND-CORE.md` linha 1376 (convencao do template).
- `docs/auditoria/AUDITORIA-PARTE-1-vs-PLANO-V2.md` topico [48] (auditoria desta lacuna, score 4/10).
- `00-PLANO-MESTRE.md` secao 6 (tabela de ADRs — onde este se inscreve).
- `01-FUNDACAO.md` linha 283 e 617 (locais que precisam alinhar a esta decisao).
- RFC 8594 (Sunset HTTP Header) — base para o header `Sunset:`.

---

**Validacao desta decisao:** quando F2 entregar, revisor confirma que (a) `?idClasse=N` retorna 200, (b) `?classe=NOME` retorna 200 com header `Deprecation` e `Sunset`, (c) request com ambos retorna 400 BadRequest, (d) `?classe=INVALIDO` retorna 404 com mensagem clara.
