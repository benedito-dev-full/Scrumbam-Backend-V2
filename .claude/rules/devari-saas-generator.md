---
# Carrega quando trabalhando com specs ou gerador
paths:
  - "docs/01*/**"
  - "templates/**"
  - "*-spec.yaml"
---

# SaaS Generator Pipeline - Devari Core

**Versao:** 1.0
**Data:** 2026-02-26
**Aplicavel a:** Pipeline de geracao de backends SaaS

---

## VISAO GERAL

O Devari Core e um template framework que permite gerar backends SaaS
em 2-3 dias (vs 2-3 semanas manual). O pipeline e:

```
Spec Narrativa (30-50k tokens)
       |
       v
  Skill spec-to-yaml (15-25min)
       |
       v
  [projeto]-spec.yaml (estruturado)
       |
       v
  Multi-Agent Code Gen (2-4h)
       |
       v
  Backend 70-80% pronto
       |
       v
  Dev customiza 20-30% (integracoes especificas)
```

---

## DECISOES ARQUITETURAIS

### ADR-100: Template Simples
- Devari Core = clone + ajusta seeds + customiza 10-30%
- NAO e framework complexo com plugins
- Integracoes via API externa

### ADR-101: SaaS Generator
- Input: spec narrativa (analise de mercado profunda)
- Pipeline 2 stages: spec-to-yaml -> multi-agent code gen
- Inventory anti-duplicacao: Devari-Core-Inventory.yaml
- Meta: 10-12 SaaS/ano

---

## SKILL spec-to-yaml

**Localizacao:** `.claude/skills/spec-to-yaml/spec-to-yaml.md`
**Status:** Validada (scrumban-spec.yaml gerado com 85% reuse)
**Funcao:** Transformar spec narrativa em YAML estruturado

**NAO MODIFICAR esta skill.** Apenas REFERENCIAR.

### Processo (7 Steps)
1. Load Resources (Inventory + Templates)
2. Read Spec Narrativa
3. Detect Type (B2B, B2C, B2B2B) e Complexity
4. Choose Template
4.5. Preparar Seed de Classes
5. Extract Structure
6. Consult Inventory (anti-duplicacao)
6.5. Verificar Endpoints Genericos
6.6. Marcar uso de Engine/Operacao
7. Generate YAML

### Tipos de Projeto Suportados
- **B2B Multi-Tenant**: Companies -> Users (CRM, Project Management)
- **B2C Individual**: Users direto (Apps pessoais)
- **B2B2B White-Label**: 3+ niveis (Marketplaces, Gateways)

---

## INVENTORY ANTI-DUPLICACAO

**Localizacao:** `docs/01 - Especificacao Devari Saas Generator/Devari-Core-Inventory.yaml`
**Tamanho:** 606 linhas
**Funcao:** Mapa do que JA EXISTE (evita duplicacao)

### Componentes Core Mapeados

| Componente | Tabela | Reusabilidade | Exemplo |
|------------|--------|---------------|---------|
| Identidades/Atores | DEntidade | 100% | Users, Orgs, Sellers |
| Lookups/Listas | DTabela | 100% | Status, Prioridades |
| Projetos/Boards | DProject | 100% | Projetos, Boards |
| Tasks/Cards | DTask | 100% | Tasks, Cards, Atividades |
| Transacoes | DPedido | 60-80% (adaptar) | Vendas, Pedidos |
| Auth | DUserGroup | 100% | Login, Permissions |
| Multi-tenant | themeConfig | 100% | Isolation por tenant |

### Regra de Consulta

Para CADA entidade na spec: consultar Inventory PRIMEIRO.
- Se existe: reusar (reuse_strategy: use_as_is)
- Se nao existe: gerar novo (reuse_strategy: generate)
- Se incerto: PERGUNTAR ao humano

---

## TEMPLATES DISPONIVEIS

**Localizacao:** `templates/`

| Template | Tipo | Hierarquia |
|----------|------|------------|
| `b2b-multi-tenant.yaml` | B2B | Company -> Users |
| `b2c-individual.yaml` | B2C | User (flat) |
| `b2b2b-white-label.yaml` | B2B2B | Provider -> Intermediary -> End User |

---

## COMO USAR

1. Preparar spec narrativa (30-50k tokens)
2. Invocar: `@skill spec-to-yaml <arquivo-spec>`
3. Revisar YAML gerado (10-20min)
4. Aprovar: `Implementar [projeto]-spec.yaml`
5. Multi-Agent gera codigo (2-4h)

**Tempo total:** 3-5 horas (spec -> backend 70-80%)
**ROI:** 5-10x velocidade vs manual

---

## REGRAS PARA AGENTS

### Strategist
- Ao planejar feature para SaaS gerado: consultar spec.yaml original
- Verificar reuse_map antes de propor novos services

### Implementer
- Ler flags do YAML: reuse_endpoint, devari_engine, controller SKIP/GENERATE
- Priorizar seed de classes como PRIMEIRA implementacao
- Respeitar Inventory (nao duplicar componentes core)

### Reviewer
- Validar que seed existe e esta correto
- Validar que endpoints genericos foram reutilizados (nao duplicados)
- Validar reuse_map coerente com implementacao
