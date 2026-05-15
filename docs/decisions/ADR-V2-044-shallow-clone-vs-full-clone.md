# ADR-V2-044: Full Clone vs Shallow Clone no Auto-Provisionamento

**Status:** Proposto (aguarda ratificação)
**Data:** 2026-05-15
**Decisores:** Strategist Agent V2 + Reviewer (apontou limitação no review do commit `156e194`)
**Tags:** #V2 #automation #f13 #milestone2-prep

## Contexto

O Milestone 1 do auto-provisionamento VPS (F13) entregou `git clone` invocado
remotamente pelo agente a partir de um comando `PROVISION_PROJECT` enviado pelo
backend. A implementação inicial adotou `DEFAULT_DEPTH = 1` (shallow clone),
com o argumento de "DoS mitigation" — evitar que um repositório gigantesco
travasse o agente no provisionamento inicial.

Durante o review do commit `156e194`, o Reviewer apontou:

- O Milestone 2 (Claude Code F13) habilita Claude Code a gerar commits no repo
  provisionado e fazer `git push` de volta para o origin (workflow tipo
  "agente de coding").
- `git push` em um repositório shallow falha com:
  `fatal: shallow update not allowed`.
- Manter shallow no Milestone 1 cria débito técnico imediato no Milestone 2.
- Migrar de shallow para full clone após o Milestone 1 já ter rodado em
  projetos provisionados exige `git fetch --unshallow` em todos eles, com
  custo operacional e risco de janela.

A janela para corrigir é AGORA, antes de qualquer projeto entrar em produção
via auto-provisionamento.

## Decisão

Adotar `DEFAULT_DEPTH = 0` (full clone) já no Milestone 1. Quando `depth === 0`,
não passar `--depth` para `git clone` — o git executa clone completo.

A mudança é cirúrgica em `agent/src/git/clone.ts` e fica documentada por este
ADR como decisão pré-Milestone 2.

## Alternativas

**A1. Manter `DEFAULT_DEPTH = 1` (shallow) + executar `git fetch --unshallow`
antes do primeiro commit no Milestone 2.**

- Pró: clone inicial mais rápido (~3-5 s vs ~10-20 s).
- Contra: adiciona round-trip git por projeto no momento em que o Claude Code
  for usado pela primeira vez. Complexidade extra no Milestone 2 e janela de
  falha (rede cai durante `fetch --unshallow` deixa o repo em estado misto).
  Custo operacional para projetos já provisionados ANTES do Milestone 2
  entrar (precisam ser migrados em batch).

**A2. Tornar `depth` configurável por projeto, com default shallow para
read-only e full para "modo Claude Code".**

- Pró: flexibilidade máxima.
- Contra: como diferenciar projetos no momento do provisionamento? O backend
  hoje não conhece o modo de uso (read-only vs coding) — isso é decisão da
  organização, não do projeto isolado. Adicionar essa configuração agora
  multiplica caminhos de execução sem ganho proporcional. YAGNI no MVP.

**A3 (escolhida). `DEFAULT_DEPTH = 0` (full clone) sempre.**

- Pró: Milestone 2 funciona sem migração; semântica simples; um único caminho
  de código. Nenhum projeto provisionado precisa ser tocado depois.
- Contra: clones de repos grandes ficam mais lentos e usam mais disco.
  Mitigação: `timeoutSec` já é configurável no payload outbound (default 60 s,
  pode ir até 600 s) e o disco da VPS é dimensionado para múltiplos projetos
  full-clone — não é restrição efetiva.

## Consequências

**Positivas:**

- Milestone 2 (Claude Code F13) pode fazer `git push` sem nenhuma migração
  posterior.
- Semântica do provisionamento é única e óbvia: clone completo, pronto para
  leitura e escrita.
- Eliminada a classe inteira de bugs "shallow update not allowed" no path do
  Claude Code.

**Negativas:**

- Provisionamento inicial 2x-4x mais lento em repos médios (segundos, não
  minutos — aceitável no caso de uso, que é único por projeto-agente).
- Repos grandes (>100 MB de histórico) podem aproximar do `timeoutSec`
  default de 60 s. Mitigação operacional: ajustar `timeoutSec` no payload
  (até 600 s) para casos conhecidos.

## Implementação

- `agent/src/git/clone.ts`: `DEFAULT_DEPTH = 0`. Quando `depth === 0`, não
  passar `--depth` para `git clone`.
- Já implementado pela Frente A do plano corretivo do Milestone 1.
- Sem mudança em DTO HTTP, contrato outbound ou schema do banco.

## Submissão ao template Devari-Core

Não. Esta decisão é específica de F13/V2 (workflow de provisionamento via
agente VPS + Claude Code). O template Devari-Core não tem o conceito de
auto-provisionamento de repositório. Manter este ADR confinado ao V2.

## Vê também

- ADR-V2-043 — Coluna `repoUrl` em DProject (precedente único de exceção ao
  ADR-V2-001; complementa este ADR como par do mesmo Milestone).
- ADR-V2-033 — Contrato `/v1/execute` outbound + `execution-result` inbound
  (define o canal pelo qual `PROVISION_PROJECT` trafega).
- ADR-V2-035 — Identidade de projeto via `projectSlug` + `CLAUDE.md` global
  (define onde o full clone é gravado dentro do agente).
