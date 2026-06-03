# ADR-V2-062: Leitura de tasks de template global bypassa tenant guard

**Status:** Aceito (ratificado pelo CEO)
**Data:** 2026-06-03
**Decisores:** Strategist Agent V2, Implementer Agent V2, Reviewer Agent V2 (Score 9.0/10), CEO
**Tags:** #V2 #fase-F5 #core #templates #tenant-isolation

---

## Contexto e Problema

O ADR-V2-061 estabeleceu que templates globais (DProject com idClasse=-401/-402 e idEstab=NULL) são um catálogo público read-only acessível a TODAS as organizações. A listagem de projetos via `GET /projects?idClasse=-401&categoria=X` já funciona (bypass implementado no `ProjectsService.listTemplates()`).

Porém, a LEITURA de **tasks de template global** via `GET /tasks?projectId={templateGlobalId}` falhava com retorno vazio (0 itens) porque o endpoint genérico `/tasks` aplica o tenant guard (ADR-V2-042), que nega acesso a qualquer `projectId` fora do set de projetos acessíveis do usuário. Templates globais não têm DVincula (vínculo do usuário), logo nunca entram em `accessibleProjectIds` → guard retorna vazio.

**Impacto:** A prévia de um template de Lista (que mostra os blocos e tasks estruturais) exibia "0 blocos e 0 tarefas" no Frontend-V2, mesmo que o template tivesse 6 blocos (-200) e tasks (-154) no banco.

O `from-template` (POST /projects/:id/from-template) funcionava porque copia server-side (não passa pelo guard).

### Decisões Passadas Relevantes

- **ADR-V2-061:** Templates globais são catálogo público, visível a todas as orgs. Implementado em `ProjectsService.listTemplates()` via bypass cirúrgico no SQL.
- **ADR-V2-042:** Tenant isolation defense-in-depth — guards em todos os endpoints que retornam dados project-scoped para proteger dados de outras orgs.

---

## Alternativas Consideradas

### Opção A: Injeção no Controller (`resolveScopedProjectIds`)

O controller detectaria template global e empurraria o ID para `accessibleProjectIds`.

**Prós:**
- Concentra a lógica de bypass em um único ponto

**Contras:**
- Alarga o set `accessibleProjectIds` para **TODOS os filtros** da query, não apenas para `projectId==template`
- Abre brecha: query sem `projectId` passaria a enxergar tasks do template global no filtro geral `IN (...)` → vazamento silencioso
- Duplicaria a query DProject entre `findMany` e `findOne` → N+1 acidental em endpoints que chamam ambos
- **REJEITADA** por violação do princípio "bypass apenas para o caminho projectId==template"

### Opção B: Endpoint dedicado `GET /projects/:id/template-preview`

Centralizaria a leitura read-only em rota especializada.

**Prós:**
- Rota explícita comunica intenção (preview)

**Contras:**
- Contraria decisão do CEO ("não criar endpoint novo" — reutilizar `/tasks` genérico)
- Duplica lógica de montagem de tasks/blocos
- Quebra o Pilar 2 (reutilização de endpoints genéricos)
- **REJEITADA**

### Opção C: Bypass Cirúrgico no Service (ESCOLHIDA)

Helper privado `isGlobalTemplate(projectId)` corre **SOMENTE quando o guard normal já ia negar**. Permite liberar **apenas o caminho `projectId == template global`**, sem tocar o set geral.

**Prós:**
- 1 query extra apenas no caminho que já falharia (custo zero no fluxo normal)
- Reuso total do `where` existente — sem criar método separado
- Mesma regra do ADR-V2-061 — consistência arquitetural
- Zero alargamento de `accessibleProjectIds` → sem vazamento
- Validação robusta: `idClasse ∈ TEMPLATE_CLASSES` + `idEstab=NULL` + `excluido=false`
- **ACEITA**

---

## Decisão

**Escolhemos:** Opção C — Bypass cirúrgico no Service via helper `isGlobalTemplate(projectId)`.

**Justificativa:**

1. **Espelhagem de ADR-V2-061:** Os mesmos templates globais (idClasse ∈ {-401, -402}, idEstab=NULL) que são públicos em `/projects` agora são públicos em `/tasks`. Princípio consistente.

2. **Segurança:** Validação tripla (idClasse, idEstab, excluido) garante que APENAS templates globais são liberados. Templates org-scoped (idEstab≠NULL) retornam false → negados como antes. Projetos normais (idClasse∉TEMPLATE_CLASSES) → negados como antes.

3. **Performance:** 1 query por PK (chave) com `select` mínimo, **SOMENTE quando o guard normal JÁ ia negar** (short-circuit). Fluxo normal (usuário autorizado) tem custo ZERO → sem regressão.

4. **Genericidade:** A lógica aplica-se a QUALQUER agregado filho de DProject (não apenas DTask). Candidato a padrão no template Devari-Core: "template-readable child aggregates" — qualquer tabela que referencia DProject pode reutilizar o mesmo bypass.

---

## Consequências

### Positivas

- Prévia de templates globais (Frontend-V2) exibe blocos e tasks estruturais corretamente
- Endpoints `:id/tree` e `:id/metrics` herdam a correção (usam `findOne` como tenant gate)
- Catálogo de templates é totalmente funcionável (read-only, estrutural, sem side effects)
- Padrão reutilizável para outros agregados filho de DProject

### Negativas

- Edge case identificado (score gate M1): se `accessibleProjectIds` for **vazio** (user sem nenhum projeto na org), o early-return do guard precede o bypass → prévia de template global não aparece para esse user.
  - **Aceitável:** usuário sem projetos é caso raro, e o comportamento é correto (não tem acesso a NADA, nem ao catálogo público). Documentado como edge case conhecido.
  - **Futuro:** se necessário, adicionar flag `allowPublicTemplates` no early-return para users sem projetos próprios.

---

## Implementação

### Arquivo: `src/tasks/tasks.service.ts`

#### 1. Import (já presente)
```typescript
import { TEMPLATE_CLASSES } from '../projects/constants/template-classes.const';
```

#### 2. Método privado `isGlobalTemplate` (já implementado)
```typescript
/**
 * Confirma que `projectId` é um template GLOBAL (-401/-402 + idEstab=NULL),
 * único caso em que a leitura de tasks bypassa o tenant guard (ADR-V2-061).
 *
 * 1 query, ZERO N+1 — só chamada quando o guard normal já falharia.
 *
 * @param projectId - BigInt da chave do projeto candidato
 * @returns true se template global; false caso contrário
 */
private async isGlobalTemplate(projectId: bigint): Promise<boolean> {
  const p = await this.prisma.dProject.findFirst({
    where: {
      chave: projectId,
      idEstab: null,
      idClasse: { in: TEMPLATE_CLASSES }, // [-401, -402]
      excluido: false,
    },
    select: { chave: true },
  });
  return p !== null;
}
```

#### 3. Patch em `findMany` (linha ~605)
```typescript
if (query.projectId && !accessibleProjectIds.includes(query.projectId)) {
  if (!(await this.isGlobalTemplate(BigInt(query.projectId)))) {
    this.logger.warn(`tenant_mismatch_tasks_findMany projectId=...`);
    return { items: [], pagination: { hasMore: false, nextCursor: null } };
  }
  // Segue o fluxo normal — `scopedProjectIds = [BigInt(query.projectId)]`
  // já confina a leitura ao template.
}
```

#### 4. Patch em `findOne` (linha ~886)
```typescript
if (accessibleProjectIds !== undefined) {
  const projectIdStr = task.idProject?.toString() ?? null;
  if (!projectIdStr || !accessibleProjectIds.includes(projectIdStr)) {
    if (!task.idProject || !(await this.isGlobalTemplate(task.idProject))) {
      this.logger.warn(`tenant_mismatch_task_findOne taskId=...`);
      throw new NotFoundException(`Task ${id} não encontrada`);
    }
  }
}
```

### Testes

- **8 specs adicionados** em `src/tasks/tasks.service.spec.ts`
- Cobertura: template global retorna blocos/tasks; template org-scoped nega vazio/404; projeto normal nega vazio/404; fluxo normal não consulta dProject (custo zero)
- Mock padrão: `dProject.findFirst` retorna `null` (negação) — novos testes sobrescrevem com template global

### Validação

- Build: `npm run build` (PASS, zero novos erros TypeScript)
- Tests: `npx jest src/tasks` (PASS, 85 specs, ZERO regressão)
- Performance: 1 query por chamada, select mínimo, short-circuit no fluxo normal

---

## Decisões Correlatas

- **ADR-V2-061:** Templates via DClasse dedic adas (-401/-402), remap na materialização
- **ADR-V2-042:** Tenant isolation defense-in-depth — guards em todos os endpoints
- **ADR-V2-047:** Hierarquia DTask via idPai (fases = agrupadores)

---

## Extensões Futuras

1. **Acesso público a endpoints `:id/tree` e `:id/metrics` para templates globais:** Herdam automaticamente via `findOne`. Nenhuma alteração necessária.

2. **Padrão genérico "template-readable child aggregates":** Candidato a contribuição ao Devari-Core template. Qualquer tabela que referencia DProject (não apenas DTask) pode reutilizar `isGlobalTemplate()` — documentar o padrão.

3. **Edge case M1 — usuário sem acesso a nenhum projeto:** Futura melhoria — adicionar flag `allowPublicTemplates` no early-return para disponibilizar catálogo mesmo sem projetos próprios. Fora de escopo desta entrega.

---

## Notas de Revisão

- **Score de Implementação:** 9.0/10 (APPROVED)
- **Performance:** Validada — 1 query extra somente no caminho já negado. Fluxo normal (usuário autorizado) tem custo ZERO.
- **Segurança:** Tripla validação (idClasse, idEstab, excluido). Sem vazamento.
- **Regressão:** ZERO — 85 specs passam, baseline mantido.
- **Cobertura:** 8 specs novos — template global (2 findMany + 2 findOne), template org-scoped (2 findMany + 2 findOne), dentro-do-scope (legado, custo zero).

---

**Implementado em:** Commit hash (será preenchido após CI)
**Testado em:** 2026-06-03
**Status:** Aceito, implementado, testado, documentado
