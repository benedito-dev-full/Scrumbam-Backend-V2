# Métricas Fase NN — [Nome da Fase]

**Fase:** NN
**Bloco:** A/B/C/D
**Período de execução:** YYYY-MM-DD a YYYY-MM-DD
**Reviewer responsável:** [nome]
**Tipo de coleta:** retro semanal + medição final

> Implementação do **ADR-V2-017** e **§8 do `00-PLANO-MESTRE.md`** (V2↔Generator Feedback Loop). Cada fase produz UM arquivo deste antes de fechar.

---

## 1. Esforço

| Item | Valor |
|------|-------|
| Tempo estimado pelo plano | X-Y semanas |
| Tempo real | Z semanas |
| Variância | ±W% |
| Tempo prometido pelo Generator (ADR-101) | 1-3 dias geração + 1-3 dias customização |
| **Gap V2 vs Generator** | **N×** |

**Causa raiz da variância (se positiva):**
- ...

---

## 2. % Boilerplate Canônico vs Específico

Medição via `cloc` + `git diff` contra baseline Devari-Core.

| Categoria | LOC | % |
|-----------|-----|---|
| Boilerplate canônico (idêntico a outros SaaS — controllers genéricos, padrões, guards, services com DEntidade/DTabela/DVincula/DEvento) | NNN | XX% |
| Específico do Scrumban (intentions V3, Risk Gate, comandos Telegram, MCP tools) | NNN | XX% |
| Configuração (DTOs, DClasses, DVFS scripts) | NNN | XX% |
| **TOTAL desta fase** | **NNNN** | **100%** |

**Meta:** ≥ 60% boilerplate canônico (alinhado com promessa do ADR-101 de 70-80%).

---

## 3. DClasses candidatas a virar fixas no template-base

| DClasse criada nesta fase | Útil para outros SaaS? | Justificativa |
|---------------------------|------------------------|----------------|
| -XXX CODIGO | Sim/Não | ... |

---

## 4. Capacidades fora do Generator atual

| Capacidade | Issue `evolution-from-v2` aberta? | Link |
|------------|-----------------------------------|------|
| ... | ✅ | #... |

---

## 5. Bugs do template descobertos

| Bug | Onde | Issue `bug-found-by-v2` | Severidade |
|-----|------|--------------------------|------------|
| ... | ... | #... | 🔴/🟡/🟢 |

---

## 6. Lições aprendidas (livres)

- Lição 1: ...
- Lição 2: ...

---

## 7. Recomendações para Devari-Core v3.0

- Recomendação 1: ...
- Recomendação 2: ...

---

**Próxima fase:** NN+1 — [Nome]
**Acumulado de evolution issues nesta fase:** N
**Acumulado total no projeto:** N
