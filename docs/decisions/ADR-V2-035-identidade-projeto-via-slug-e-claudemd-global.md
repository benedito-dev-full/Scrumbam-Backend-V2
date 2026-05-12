# ADR-V2-035 — Identidade de Projeto via `projectSlug` + `CLAUDE.md` global na VPS

**Status:** Aceito
**Data:** 2026-05-12
**Decisores:** CEO (decisão arquitetural 2026-05-12), Strategist Agent V2 (proposta), Implementer V2 (execução nas Sub-tarefas 2 e 4 do plan-task1)
**Tags:** `#V2` `#F13` `#automation` `#agent` `#security` `#path-injection` `#identity`

> **Nota de numeração:** este ADR foi planejado como `ADR-V2-030` no `plan-automation-agent-v2-client-task1.md`, mas o número 030 já estava ocupado por dois ADRs prévios (`ADR-V2-030-multi-tenant-identity.md` e `ADR-V2-030-contrato-dispatcher-stub.md`). Promovido para **035** para preservar unicidade. Referências cruzadas no plano e nos commits que mencionam "ADR-V2-030 (identidade slug)" devem ser lidas como "ADR-V2-035".

---

## Contexto e Problema

O agente legado (referência: `Scrumbam-Backend/agent/`) recebia `cwd` absoluto no payload de cada comando (`{"executable": "claude", "cwd": "/home/dev/projetos/scrumban-backend", ...}`). Esse desenho tinha três problemas:

1. **Path injection.** O backend confiava no path enviado e o agente executava `claude` ali. Um atacante com acesso ao banco/queue/API podia injetar `cwd=/etc` ou `cwd=/home/dev/.ssh` e usar Claude Code como vetor de leitura/escrita arbitrária. Mitigação possível (allowlist no agente) não eliminava o risco — só o reduzia.
2. **Acoplamento VPS↔backend.** Se a VPS reorganizasse pastas (`/home/dev/projetos → /opt/projetos`), todo registro de `DProject.dados.remotePath` no backend quebrava. Migração custosa.
3. **Vazamento de filesystem para o frontend.** Quando o frontend mostra "Agente vai executar em X", o X é o path absoluto da VPS — vaza topologia de filesystem do servidor de produção.

A F13 backend-side já havia mitigado parcialmente (allowlist `WORKSPACE_OUTSIDE_ALLOWED_ROOT`, encriptação do payload), mas o desenho ainda partia do path absoluto.

CEO trouxe nova decisão em 2026-05-12: **o agente não recebe mais path absoluto. Recebe apenas um identificador opaco (`projectSlug`). O agente resolve o path lendo um arquivo `~/.claude/CLAUDE.md` global na VPS, mantido manualmente pelo CEO.**

---

## Alternativas Consideradas

### Alternativa A — `projectSlug` + `CLAUDE.md` global na VPS (escolhida)

Backend envia `projectSlug: "scrumban-backend-v2"`. Agente lê `/root/.claude/CLAUDE.md` (default; configurável), procura entrada com cabeçalho `## scrumban-backend-v2`, extrai linha `Caminho: /home/dev/projetos/scrumban-backend-v2`, valida que o path resolvido (após `realpath` anti-symlink) está sob `config.allowedProjectRoots`, e invoca `claude -p` com esse `cwd`.

**Prós:**
- Backend NUNCA vê path absoluto — elimina ~80% da superfície de path injection.
- VPS pode renomear pastas livremente — basta CEO atualizar `CLAUDE.md`. Zero migração no backend.
- Frontend vê apenas o slug humano (`scrumban-backend-v2`), nunca o path.
- `CLAUDE.md` é arquivo conhecido do Claude Code CLI (mesma fonte que o CLI usa para contexto manual) — reúso natural, sem novo formato.
- Allowlist no agente (`config.allowedProjectRoots`) continua existindo como **defesa em profundidade** contra `CLAUDE.md` adulterado por atacante local na VPS.

**Contras:**
- Setup manual: CEO precisa popular `CLAUDE.md` ao clonar novos repos na VPS. Não é automático.
- Slug desalinhado entre backend e VPS quebra silenciosamente — o agente retorna `UNKNOWN_PROJECT_SLUG` no `execution-result`, mas o usuário só vê o erro depois de tentar executar.
- Se o `CLAUDE.md` for adulterado por atacante com shell na VPS, atacante pode redirecionar slug para path malicioso. Mitigação: arquivo é 0644 (não-escrita por non-root), allowlist defensiva, `ProtectHome=read-only` no systemd impede o próprio agente de escrever.

### Alternativa B — `DProject.chave` numérica no payload + path do banco

Backend envia `projectId: 42`, agente consulta banco (ou o backend devolve path resolvido).

**Prós:** sem `CLAUDE.md` manual.
**Contras:**
- Vaza chave interna do banco em logs/HTTP traces (BigInt `42` é menos útil que `scrumban-backend-v2` para humanos).
- Agente cliente fica acoplado ao schema (Prisma) ou a um endpoint adicional do backend só para resolver path — aumenta superfície.
- Resolve identidade mas NÃO resolve path injection: o backend ainda precisa do path em algum momento para popular `DProject.dados.remotePath`.

Rejeitada.

### Alternativa C — Path absoluto criptografado no payload (envelope AES)

Backend assina/cripta `cwd` com chave compartilhada; agente decifra.

**Prós:** mantém modelo legado conhecido.
**Contras:**
- Não elimina o vetor: backend continua sendo a fonte de verdade do path; um bug no backend (validation, queue poisoning) gera path inválido criptografado, mas válido após decifrar.
- Frontend ainda vê o path (se o backend exibir) — ou não vê, e perde rastreabilidade.
- Não permite renomeação de diretórios na VPS sem migração.

Rejeitada.

---

## Decisão

**Backend outbound usa exclusivamente `projectSlug` no payload `RUN_CLAUDE_CODE`** (campo `projectSlug: string`, derivado de `slugify(DProject.nome)` na criação do projeto, persistido em `DProject.dados.slug`, UNIQUE indexável). **Agente resolve slug via `~/.claude/CLAUDE.md` global na VPS** (default `/root/.claude/CLAUDE.md`; configurável em `claudeMdPath`). **Allowlist `config.allowedProjectRoots` permanece como defesa em profundidade**, validada com `realpath` (anti-symlink).

Formato canônico de entrada no `CLAUDE.md`:

```markdown
## <projectSlug>
Caminho: /caminho/absoluto/na/vps
```

(`Path:` também aceito como sinônimo de `Caminho:` para usuários de fala inglesa.)

Erros canônicos do agente:
- `UNKNOWN_PROJECT_SLUG` — slug não encontrado no `CLAUDE.md`.
- `WORKSPACE_OUTSIDE_ALLOWED_ROOT` — path resolvido fora da allowlist.
- `CLAUDE_MD_UNREADABLE` — arquivo ausente/permission denied.

Esses erros voltam via `POST /agents/:id/execution-result` com `success: false` e payload estruturado; backend materializa DEvento `agent.execution.failed` (idClasse=-515) com `reason` para auditoria.

---

## Consequências

### Positivas

- **Eliminação total de path injection no protocolo wire** (~80% da superfície original). Agente nunca confia em path vindo de fora — só em `CLAUDE.md` local (que está no `ProtectHome=read-only` do systemd).
- **VPS pode renomear pastas sem coordenação com backend** — basta CEO atualizar `CLAUDE.md`. Zero migração, zero downtime.
- **Slug humano em logs** (`scrumban-backend-v2`) vs chave numérica (`42`) — debugging significativamente mais rápido.
- **Frontend nunca vê path absoluto** — vaza apenas o slug, que é dado de identidade pública do projeto (igual ao slug de URL).
- **Defesa em profundidade preservada:** mesmo que atacante adultere `CLAUDE.md`, allowlist do agente bloqueia paths fora de `config.allowedProjectRoots`.
- **Compatibilidade nativa com Claude Code CLI:** `CLAUDE.md` é arquivo padrão do CLI, não invenção do Scrumban.

### Negativas (e mitigações)

- **Manutenção manual de `CLAUDE.md`:** CEO precisa popular ao clonar novos repos. Mitigação: `install.sh` copia `CLAUDE-md-template.md` apenas se `CLAUDE.md` ausente (não popula automaticamente — evita prompt injection via install). README documenta o fluxo.
- **Slug fora de sync entre backend e VPS** retorna erro tardio (`UNKNOWN_PROJECT_SLUG`). Mitigação aceita: erro estruturado + DEvento + log de auditoria. Frontend pode futuramente expor "Status de mapping VPS" lendo do backend.
- **Adulteração local de `CLAUDE.md`** por atacante com shell na VPS é possível. Mitigação: arquivo é 0644 (só root escreve), `ProtectHome=read-only` no systemd impede agente de escrever, allowlist bloqueia paths inválidos.

### Neutras

- **Backend mantém `DProject.dados.slug` UNIQUE** — implementado na Sub-tarefa 2.3 do plan-task2 (`ProjectsService.create()` deriva slug, migration backfilla projetos legados).
- **Não há novo endpoint** no backend para resolver slug → path. Resolução é 100% no agente. Backend só sabe slugs, não paths.

---

## Validação

### Hooks de validação acionados

- `__tests__/identity-resolver.spec.ts` (Sub-tarefa 4) — 12 specs cobrindo `UNKNOWN_PROJECT_SLUG`, parsing de `Caminho:` vs `Path:`, fallback case-sensitive, formato inválido, ausência de arquivo.
- `__tests__/run-claude-code.spec.ts` (Sub-tarefa 4) — testes adversariais de allowlist: symlink saindo da raiz permitida → rejeita; path com `../` → rejeita; path equivalente após `realpath` na allowlist → aceita.
- Integration test E2E (manual, executado pelo CEO na VPS após Sub-tarefa 6): backend envia `RUN_CLAUDE_CODE` com slug desconhecido → `execution-result` retorna `success: false, reason: UNKNOWN_PROJECT_SLUG` em ≤ 5s.
- Code review (Reviewer Agent V2) das Sub-tarefas 2, 4 e 6 verificou explicitamente: zero ocorrência de `cwd` no payload outbound, zero referência a path absoluto vindo do backend.

### Gatilho de revisão

Reavaliar este ADR se:
1. CEO decidir automatizar populamento de `CLAUDE.md` (ex: agente registra novos slugs via `agent.session.created` + backend pinga ferramenta de provisioning). Requer ADR novo cobrindo o trust model de "quem pode escrever no `CLAUDE.md`".
2. Volume de projetos crescer ao ponto que `CLAUDE.md` manual vire bottleneck. Hoje é zero atrito — CEO mantém ~5 projetos.
3. Surgir requisito de slug case-insensitive ou normalização Unicode — atualmente o agente faz match exato (case-sensitive).

---

## Referências

- `workspace/plans/plan-automation-agent-v2-client-task1.md` §4 (Estrutura Técnica), §5 Sub-tarefa 2 (allowlist) e Sub-tarefa 4 (identity-resolver).
- `workspace/plans/plan-automation-backend-side-task2.md` Sub-tarefa 2.3 (derivação de slug em `ProjectsService.create`).
- `agent/src/claude-code/identity-resolver.ts` — implementação parser.
- `agent/src/claude-code/allowlist.ts` — validação `realpath` + allowlist.
- `agent/CLAUDE-md-template.md` — formato canônico.
- ADR-V2-001 (zero tabela nova — slug cabe em `DProject.dados`).
- ADR-V2-033 (contrato `/v1/execute` outbound + `execution-result` inbound — sem `cwd`).
- ADR-V2-036 (monorepo `Scrumban-Backend-V2/agent/`).
- ADR-V2-037 (ponteiro de sessão Claude Code — complementar para chat-with-VPS).
