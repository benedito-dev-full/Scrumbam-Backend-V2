---
# Nao e path-specific - aplica a qualquer contexto de git commit
---

# Conventional Commits - Padrao Devari Core

**Versao:** 1.0
**Data:** 2026-02-26
**Baseado em:** [Conventional Commits 1.0.0](https://www.conventionalcommits.org/)

---

## FORMATO OBRIGATORIO

```
<type>(<scope>): <subject>

<body>

<footer>
```

---

## ESTRUTURA DETALHADA

### 1. Type (Obrigatorio)

Identifica a natureza da mudanca:

| Type | Quando usar | Exemplo |
|------|-------------|---------|
| `feat` | Nova funcionalidade | `feat(engine): adiciona validacao customizada no workflow OperacaoPedido` |
| `fix` | Correcao de bug | `fix(eventos): corrige roteamento de eventos para fila de processamento` |
| `docs` | Apenas documentacao | `docs(core): adiciona guia completo do template framework` |
| `refactor` | Refatoracao sem mudanca de comportamento | `refactor(endpoints): simplifica controller generico de entidades` |
| `perf` | Melhoria de performance | `perf(endpoints): otimiza query de listagem com indice parcial` |
| `test` | Adicionar ou corrigir testes | `test(entidades): adiciona testes de integracao` |
| `chore` | Mudancas em build, configs, etc. | `chore(deps): atualiza dependencias` |
| `style` | Formatacao (sem mudanca de logica) | `style(auth): formata codigo com prettier` |

**Escolher type correto e importante para CHANGELOG automatico!**

---

### 2. Scope (Obrigatorio)

Identifica o modulo afetado:

| Scope | Modulo |
|-------|--------|
| `engine` | src/engine/ |
| `seeds` | prisma/seeds/ |
| `endpoints` | src/entidades/, src/tabelas/ (endpoints genericos) |
| `core` | src/database/, src/common/ |
| `auth` | src/auth/ |
| `eventos` | src/eventos/ |
| `entidades` | src/entidades/ |
| `pagamento` | src/pagamento/ |
| `common` | src/common/ |
| `agents` | .claude/agents/ |
| `docs` | docs/ |

**Se afeta multiplos modulos:** use o modulo principal ou `core`.

---

### 3. Subject (Obrigatorio)

Descricao breve **em portugues** do que foi feito.

**Regras:**
- Maximo 72 caracteres
- Primeira letra minuscula
- Sem ponto final
- Imperativo ("adiciona" nao "adicionado" ou "adicionando")
- Claro e objetivo

```bash
# CORRETO
feat(engine): adiciona validacao customizada no workflow OperacaoPedido

# ERRADO
feat(engine): Adicionado validacao no workflow.  # Maiuscula + ponto final
feat(engine): adicionando validacao              # Gerundio
feat: validacao no workflow                      # Sem scope
```

---

### 4. Body (Altamente Recomendado)

Descricao detalhada das mudancas, uma por linha com hifen:

```
- Feature 1: descricao detalhada
- Feature 2: descricao detalhada
- Tests: quantidade e resultado
- Documentation: o que foi documentado
- Performance: metricas se relevante
```

**Exemplo:**
```
feat(engine): adiciona validacao customizada no workflow OperacaoPedido

- Engine:
  * OperacaoPedido.validate() aceita callbacks customizados
  * Validacoes executam antes de calcula()
  * Erros de validacao retornam ValidationError

- DTOs:
  * CustomValidationDto (estrutura de regras)
  * ValidationResultDto (resultado detalhado)

- Tests:
  * 8 unit tests (100% pass)
  * 3 integration tests (100% pass)

- Documentation:
  * JSDoc completo (10 exemplos)
  * Swagger decorators
```

---

### 5. Footer (Opcional)

Referencias a issues, breaking changes, etc.

```
Closes #123
Refs #456

BREAKING CHANGE: Remove campo deprecated 'idLogin' (usar 'dUserGroupId')
```

---

## EXEMPLOS COMPLETOS

### Exemplo 1: Nova Feature

```
feat(engine): adiciona validacao customizada no workflow OperacaoPedido

- Engine:
  * OperacaoPedido.validate() aceita callbacks customizados
  * Validacoes executam antes de calcula()
  * Erros de validacao retornam ValidationError

- Tests:
  * 8 unit tests (100% pass)
  * 3 integration tests (100% pass)

Closes #42
```

### Exemplo 2: Bug Fix

```
fix(eventos): corrige roteamento de eventos para fila de processamento

- Problema:
  * Eventos de tipo 'entity.created' nao eram roteados corretamente
  * Campo 'type' ausente no payload processado

- Solucao:
  * EventRouter.isEntityEvent() corrigido (linha 43)
  * Payload agora propaga 'type' obrigatoriamente

- Tests:
  * 4 integration tests (entity + order events)
  * Backward compatibility mantida

Fixes #89
```

### Exemplo 3: Refactoring

```
refactor(agents): moderniza orchestrator workflow com padroes 2026

- Agents:
  * YAML frontmatter completo (tools, hooks, skills)
  * Auto-validacao via hooks Stop
  * Skills centralizadas em .claude/rules/

- Orchestrator:
  * Task System para estado persistido
  * Validacoes delegadas para hooks

- Skills criadas:
  * devari-backend-patterns.md (700L)
  * devari-jsdoc-templates.md (500L)
  * devari-conventional-commits.md (250L)
  * devari-event-naming.md (300L)

Refs #ADR-101
```

### Exemplo 4: Performance

```
perf(endpoints): otimiza query de listagem com indice parcial

- Query:
  * Adiciona indice em (idClasse, chcriacao) WHERE excluido = false
  * Remove full table scan

- Performance:
  * Query time: 2.3s -> 45ms (-98%)
  * Throughput: 100 req/s -> 800 req/s (+700%)

- Tests:
  * Load test: 1000 concurrent requests
  * Latency p95: <100ms

Closes #67
```

---

## REGRAS CRITICAS

1. **SEMPRE incluir scope** (modulo)
2. **Subject em portugues** (equipe e brasileira)
3. **Body detalhado** para commits importantes (features, fixes)
4. **Listar testes** no body (quantidade + status)
5. **Metricas de performance** se aplicavel
6. **Closes #N** se resolve issue do ROADMAP

---

## COMMITS RUINS (Evitar)

```bash
# Muito vago
fix: corrige bug

# Sem scope
feat: novo endpoint

# Subject em ingles
feat(engine): add validation to workflow

# Gerundio
feat(engine): adicionando validacao

# Sem body em commit importante
feat(engine): adiciona validacao customizada
# (Sem explicar o que e, como funciona, testes, etc.)
```

---

**Este skill sera usado pelo Documenter agent ao criar git commits.**
