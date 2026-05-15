# ADR-V2-044: Full Clone vs Shallow Clone na VPS

**Status:** Aceito  
**Data:** 2026-05-15  
**Decisores:** Strategist Agent V2 + CEO  
**Tags:** #V2 #automation #f13 #agent #git

## Contexto

O handler `PROVISION_PROJECT` no agente VPS executa `git clone` do repositório do projeto. Havia duas opções:

- **Shallow clone** (`depth=1`): clona apenas o último commit. Mais rápido, menor uso de disco.
- **Full clone** (`depth=0`): clona o histórico completo. Compatível com `git push`.

## Problema com shallow clone

O Milestone 2 da F13 prevê que o agente faça `git push` após executar Claude Code (commits automáticos). O `git push` para repositórios remote **falha em shallow clones** com o erro `shallow update not allowed` quando o remote não aceita shallow updates.

## Decisão

**`depth=0` (full clone)** para todos os provisionamentos.

- `DEFAULT_DEPTH = 0` em `provision.service.ts`
- O agente usa `options.depth ?? 1` como fallback interno; o backend DEVE enviar `depth: 0` explicitamente para garantir full clone.

## Consequências

- Clone inicial é mais lento e ocupa mais disco (proporcional ao histórico do repositório).
- `git push` funciona sem restrições no Milestone 2.
- Para repositórios grandes, o operador pode considerar `git clone --filter=blob:none` (partial clone) em versão futura — isso seria um ADR separado.

## Alternativas rejeitadas

- **`depth=1` + `git fetch --unshallow` antes do push**: adiciona complexidade no handler de push; rejeitado por simplicidade.
- **Shallow para clone, full para push**: requer lógica condicional no agente; rejeitado.
