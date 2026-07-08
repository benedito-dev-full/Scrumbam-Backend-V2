# ADR-V2-062: Promoção de Projeto/Lista para Template (Extensão ADR-V2-061)

**Status:** Aceito (Approved por Reviewer Agent V2 — Score 9.0/10)  
**Data:** 2026-07-08  
**Decisores:** Strategist Agent V2, Implementer Agent V2, Reviewer Agent V2  
**Tags:** #V2 #fase-F11 #endpoints #feature-templates #remap-classe  

---

## Contexto e Problema

A feature Templates (ADR-V2-061) implementou o caminho **template → projeto real**:
- `POST /projects/:id/from-template` materializa um DProject com idClasse -401 (TEMPLATE_LIST) ou -402 (TEMPLATE_SPACE) numa árvore real, remapeando para -352 (LIST) / -350 (SPACE).
- O catálogo (`GET /projects?idClasse=-401&categoria=X`) lista templates por categoria livre, permitindo ao CEO reutilizar estruturas validadas.

**O que falta:** o caminho **inverso** — "projeto/lista comum → vira template" — para que o CEO possa:
1. Pegar uma estrutura de blocos já validada em produção (ex: lista "Testes E2E", id 108, com 3 blocos estruturados)
2. Promovê-la a template reutilizável
3. Aparecendo automaticamente na galeria de templates sob uma categoria escolhida explicitamente

**Requisito crítico do CEO:** A promoção **cria uma CÓPIA** como template; o projeto original (ex: "Testes E2E", id 108) permanece intacto e utilizável com suas ~49 tasks de trabalho específicas.

---

## Alternativas Consideradas

### Alternativa A — Mutação In-Place (idClasse original → template)

**Prós:**
- Zero linhas de clone, "promoção" literal (palavra-chave → ação simples)

**Contras:**
- ❌ **DESTRUTIVO**: projeto original desaparece instantaneamente das listagens de trabalho (TEMPLATE_CLASSES exclui templates de queries padrão)
- ❌ Todas as 49 tasks de trabalho ficam "presas" atrás de uma DClasse de template — acessibilidade prejudicada
- ❌ **Irreversível** sem ADR de rollback e operação manual
- ❌ **Contradiz explicitamente o requisito CEO**: "preservar o projeto original intacto"

**Decisão:** ❌ **REJEITADA** — instância de perda de dados operacional.

---

### Alternativa B — Reimplementar Clone Especifico (sem reaproveitar `cloneTree`)

**Prós:**
- Isolamento total: nenhum risco de efeito colateral em `duplicate()`/`from-template()`

**Contras:**
- ❌ Duplica ~250 linhas de lógica crítica (CTE recursiva, transaction, slug, espelho+DVincula, seed de statuses, copyPhases)
- ❌ Viola DRY (Don't Repeat Yourself), dobra a superfície de bugs
- ❌ Qualquer fix futuro no motor (ex: bug de slug) teria que ser replicado em **dois lugares**
- ❌ Risco de regressão sem ganho arquitetural

**Decisão:** ❌ **REJEITADA** — manutenção insustentável a longo prazo.

---

### Alternativa C — Estender `CloneTreeOptions` com Remap Inverso + Categoria ✅ **ESCOLHIDA**

**Prós:**
- ✅ Reaproveita **100% da lógica provada** em produção (`cloneTree` já foi testado em `duplicate()` e `createFromTemplate()`)
- ✅ Adiciona **apenas o remap inverso** (mapa invertido: -352→-401, -350→-402) e carimbo de `dados.categoria`
- ✅ Consistente com o padrão arquitetural já estabelecido por `duplicate()`/`createFromTemplate()` (cásulas finas sobre motor)
- ✅ **Zero regressão** nos caminhos legados (ramo separado no ternário de `idClasseMaterializada`)

**Contras:**
- `CloneTreeOptions` acumula mais um parâmetro de opções (leve aumento de complexidade cognitiva) — **mitigado por JSDoc extenso**

**Decisão:** ✅ **ACEITA** — custo/benefício ótimo, zero risco.

---

## Decisão

**Escolhemos:** Alternativa C — Estender `CloneTreeOptions` com remap inverso de classe + categoria obrigatória (texto livre).

### Justificativa

1. **Reuso de motor provado:** `cloneTree` já processa:
   - Slug único via `deriveUniqueSlug`
   - Espelho -158 + DVincula MANAGER via `ensureEntidadeRef`/`createManagerLink`
   - Seed de statuses V3 via `seedBootstrap.seedProject` (condicionado a classe -352 real)
   - Cópia de blocos via `copyPhases`
   - Emissão de evento pós-persistência
   - **Zero N+1 queries** (CTE recursiva reutilizada)

2. **Simetria com `fromTemplate`:** O remap de classe é bidirecional:
   - `fromTemplate`: -401→-352, -402→-350 (template → real)
   - `toTemplate` (novo): -352→-401, -350→-402 (real → template) — inverso exato

3. **Decisão "CÓPIA, não mutação" responde aos 3 requisitos:**
   - Preserva projeto original intacto (operacional)
   - Reusa semântica com `duplicate()` e `createFromTemplate()` (previsibilidade)
   - Evita perda de dados (segurança)

4. **Categoria obrigatória, sem default:** Texto livre escolhido pelo usuário no DTO (sem enum fechado). Permite que o CEO crie categorias novas em runtime sem alterar código. Reutiliza `GET /projects?idClasse=-401&categoria=X` existente.

---

## Consequências

### Positivas

- ✅ Motor único (`cloneTree`) centraliza TODA lógica de clone — qualquer fix se propaga automaticamente para `duplicate`, `createFromTemplate`, **e agora** `promoteToTemplate`
- ✅ Zero N+1 queries (CTE recursiva já testada, reutilizada)
- ✅ Projeto original intacto, completamente operacional — CEO continua usando "Testes E2E" com suas 49 tasks
- ✅ Template resultante aparece no catálogo imediatamente (`GET /projects?idClasse=-401&categoria=Desenvolvimento`)
- ✅ Semanticamente simetria com o caminho `fromTemplate` (bidireccionalidade clara)
- ✅ **Sem mudança de banco/schema** — reutiliza colunas existentes, zero migration
- ✅ RBAC herdado (gate MANAGER na origem roda dentro de `cloneTree`, sem reimplementar)

### Negativas

- ⚠️ `CloneTreeOptions` fica com 7 parâmetros (antes 5) — pequeno aumento de complexidade cognitiva
  - **Mitigação:** JSDoc extenso documenta cada opção
- ⚠️ Remap de classe aplicado em **profundidade** (não só na raiz):
  - List filha dentro de Space promovido **também vira -401** (template)
  - Folder (-351) não é remapeado (fora do mapa) — comportamento correto e simétrico ao `fromTemplate`
  - **Mitigação:** Documentado no JSDoc, coberto por teste dedicado

---

## Implementação

### Arquivos Afetados

| Arquivo | Mudança | Tipo |
|---------|---------|------|
| `src/projects/dto/promote-to-template.dto.ts` | Novo DTO (`PromoteToTemplateDto`) | Criado |
| `src/projects/projects.service.ts` | `CloneTreeOptions` estendido + `REAL_TO_TEMPLATE_CLASS_REMAP` + `promoteToTemplate()` | Modificado |
| `src/projects/projects.controller.ts` | Novo endpoint `POST /projects/:id/promote-to-template` | Modificado |
| `src/projects/projects.service.spec.ts` | 10 testes novos para `promoteToTemplate()` | Modificado |

### Fluxo de Execução

```typescript
1. Controller recebe POST /projects/:id/promote-to-template com PromoteToTemplateDto
   ├─ categoria: string obrigatório (texto livre, sem default)
   └─ novoNome?: string opcional

2. Service.promoteToTemplate() valida:
   ├─ Origem existe e é LIST (-352) ou SPACE (-350)
   ├─ Usuário tem MANAGER na origem (delegado a cloneTree)
   └─ Org ativa presente no JWT

3. Delega a cloneTree com:
   ├─ toTemplate: true (ativa remap inverso)
   ├─ categoriaTemplate: dto.categoria (gravado em dados.categoria da raiz)
   └─ idEstabDestino: orgIdBig (template nasce org-scoped)

4. cloneTree():
   ├─ idClasseMaterializada: usa REAL_TO_TEMPLATE_CLASS_REMAP se opts.toTemplate
   ├─ copyPhases roda (blocos copiados)
   ├─ seedProject NÃO roda (resultado é template -401, não List real -352)
   ├─ Evento project.created emitido com discriminador promotedToTemplate: true
   └─ Transaction atomicamente persiste tudo

5. Controller retorna ProjectResponseDto da cópia template
```

### Validações

| Cenário | Resultado |
|---------|-----------|
| Origem inexistente/excluída | 404 NotFoundException |
| Origem não é LIST/SPACE (ex: Folder -351) | 400 BadRequestException |
| Usuário sem MANAGER na origem | 403 ForbiddenException (herdado de `cloneTree`) |
| Categoria ausente no DTO | 400 BadRequestException (class-validator) |
| Org ativa ausente no JWT | 400 BadRequestException |

### Endpoints REST

```http
POST /projects/:id/promote-to-template
Content-Type: application/json

{
  "categoria": "Desenvolvimento",
  "novoNome": "Molde QA E2E"
}

Response 201 Created:
{
  "chave": "456",
  "nome": "Molde QA E2E",
  "idClasse": "-401",
  "dados": {
    "categoria": "Desenvolvimento",
    ...
  }
}
```

### Query Prisma Adicional

Uma query leve de validação de `idClasse` da origem (find simples, padrão do arquivo). A CTE recursiva de clone já está reutilizada (zero query nova).

---

## Testes

### Cobertura

| Cenário | Teste | Status |
|---------|-------|--------|
| Promove LIST com 3 blocos, N tasks → resultado -401, blocos copiados, ZERO tasks, categoria gravada | ✅ | PASS |
| Emite `project.created` com `promotedToTemplate: true` | ✅ | PASS |
| Promove SPACE com Folder+List filhas → raiz -402, Folder -351, List interna -401 | ✅ | PASS |
| Sem MANAGER na origem → 403 ForbiddenException | ✅ | PASS |
| Origem inexistente → 404 NotFoundException | ✅ | PASS |
| Origem é Folder (-351) isolado → 400 BadRequestException | ✅ | PASS |
| Categoria vazia no body → 400 (class-validator) | ✅ | PASS |
| Org ativa ausente no token → 400 BadRequestException | ✅ | PASS |
| Template nasce com `idEstab` = org ativa (não NULL/global) | ✅ | PASS |
| Projeto original permanece intacto (só CREATE, nunca UPDATE/DELETE) | ✅ | PASS |

**Total: 10 testes novos, 100% PASS** (baseline intacto, zero regressão)

---

## Relacionamentos com Outras ADRs

| ADR | Relação |
|-----|---------|
| **ADR-V2-061** | Pai direto — `promoteToTemplate` é caminho inverso de `createFromTemplate` |
| **ADR-V2-042** | Tenant check — heredado de `cloneTree`, mesma validação |
| **ADR-V2-058** | Espelho -158 + DVincula MANAGER — reutilizado via `ensureEntidadeRef`/`createManagerLink` |
| **ADR-V2-051** | Seed de statuses V3 — condicionado a classe -352 real (templates -401 não usam statuses) |

---

## Decisões Futuras / Fora de Escopo

- **Frontend/UI:** Botão "Promover a Template" não está neste escopo. Requer fase separada com aval visual do CEO (feedback de design intocável registrado). Handoff proposto em plano dedicado (`plan-templates-promote-to-template-frontend-taskN.md`).
- **Enum fechado de categorias:** Backend mantém texto livre (como hoje). Frontend pode oferecer autocomplete/sugestões, decisão visual.

---

## Referências

- **Plan:** `workspace/plans/plan-templates-promote-to-template-task7.md`
- **Implementation:** `workspace/implementations/impl-endpoints-promote-to-template-task7.md`
- **Review:** `workspace/reviews/review-projects-promote-to-template-task7.md`
- **Código:** `src/projects/dto/promote-to-template.dto.ts`, `src/projects/projects.service.ts` (método `promoteToTemplate`), `src/projects/projects.controller.ts`

---

**Mantido por:** Documenter Agent V2  
**Status:** ✅ ACEITO (Score 9.0/10, Reviewer aprovado)
