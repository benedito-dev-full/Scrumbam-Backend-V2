# ADR-V2-040: HMAC Bilateral Agent ↔ Backend (Paridade `x-scrumban-*`)

**Status:** Aceito (após Task #1 F13 Automation Fase 13)
**Data:** 2026-05-13
**Decisores:** Implementer Agent V2, Reviewer Agent V2, Documenter Agent V2
**Tags:** #V2 #fase-F13 #automation #security #agent #hmac

---

## Contexto e Problema

O **contrato HTTP entre agente VPS e backend** define 4 superfícies de comunicação:

1. **Agent outbound (inicial):** Agent envia heartbeat + execution result
2. **Backend outbound:** Backend dispara `/v1/execute` para agent via reverse tunnel SSH
3. **Agent inbound (validação):** Agent recebe `/v1/execute`
4. **Backend inbound:** Backend recebe heartbeat + execution result

**Estado anterior a esta decisão:**

- Superfícies 2, 3: Implementadas com HMAC-SHA256 simétrico (headers `x-scrumban-*`, canonical string idêntico)
- **Superfícies 1, 4: Divergentes**
  - Agent outbound: Agent assinava HMAC (headers `x-scrumban-*`) mas backend não validava
  - Backend inbound: Guard (`AgentAuthGuard`) validava apenas apiKey plaintext (headers `x-agent-*`), comparado com hash em `dEntidade.dados.apiKeyHash`
  
**Problema:** 3 dos 4 lados do contrato falavam HMAC. 1 lado (backend inbound) falava apiKey-plaintext. Divergência violava ADR-V2-033 (contrato HTTP+HMAC) documentado nos comentários de `hmac.middleware.ts` e `remote-execution-client.ts`.

**Risco de segurança:** A implementação anterior (apiKey-plaintext) dependia de SSH como canal cifrado. Porém, o reverse tunnel SSH usa `bindHost=172.17.0.1` (docker0 bridge), permitindo que qualquer container na rede docker host alcance a ponta do túnel sem passar pelo SSH. **HMAC do body protege contra container malicioso intra-host.**

---

## Alternativas Consideradas

### Alternativa A: Manter protocolo simplificado (apiKey-plaintext)

**Prós:**
- Zero mudança no backend (guard existente intacto)
- Zero risco de regressão em outras rotas
- ValidationPipe funciona se agent só enviar campos whitelisted

**Contras:**
- Viola ADR-V2-033 (HMAC bilateral é canônico)
- Mantém dívida técnica documentada ("melhoria futura")
- Cada novo agent provisionado fala protocolo divergente de 3 dos 4 lados
- Acumula débito de segurança em profundidade

**Resultado:** Rejeitada

### Alternativa B: Feature flag dual-protocol

**Prós:**
- Deploy gradual; flag ativa HMAC quando agents estiverem prontos
- Permite rollback seguro

**Contras:**
- Aumenta superfície de ataque (duas formas de autenticar = atacante explora a mais fraca)
- Complica guard com lógica condicional
- Custa 3-4h extras de testes
- **Não é necessária:** Agent argus em produção já fala HMAC (bundle deployado anterior aos patches #5 do operador; repo é que diverge)

**Resultado:** Rejeitada para esta task. Porta aberta para ADR-V2-041 (limpeza) se descobrirmos que bundle em produção diverge.

### Alternativa C: Migrar para mTLS no túnel

**Prós:**
- mTLS cobre todas 4 superfícies de uma vez (sem assinatura por request)
- Padrão de segurança mais robusto

**Contras:**
- Reformula `install.sh` (cert client, pinning)
- Atualiza tela de instalação + runbook + ADRs
- ~3-5 dias de trabalho
- Fora de escopo desta task

**Resultado:** Rejeitada. Fica como nota para F14 (Hardening).

---

## Decisão

**Escolhemos:** Alternativa A corrigida — **reescrever backend inbound (`AgentAuthGuard`) para validar HMAC-SHA256 com canonical idêntico aos 3 outros lados.**

**Justificativa:**

1. **Simetria de código:** 3 dos 4 lados já implementam o mesmo algoritmo. Replicar pela quarta vez é mecânico e auditável.
2. **Debt closure:** Comentário em `hmac-sign.ts` linhas 38-43 admitia débito ("protocolo simplificado por canal SSH"). Completar ADR-V2-033 fecha débito em vez de adiar.
3. **Defesa em profundidade:** SSH é o primeiro canal, mas HMAC do body protege contra container malicioso intra-host (docker0 bridge).
4. **Operacional:** Agent argus (agentId=32, produção) já possui `agentCommandSecretEncrypted` provisionado. Bundle deployado fala `x-scrumban-*`. Revertendo patches #5 no repo alinha o código-fonte ao que já roda em produção — **zero rebuild de agent necessário.**

---

## Consequências

### Positivas

- ✅ **HMAC bilateral em todas 4 superfícies** — ADR-V2-033 completada sem dívida técnica
- ✅ **Defesa em profundidade** contra container malicioso no docker host
- ✅ **Compatível com agent argus em produção** — bundle já fala `x-scrumban-*`; nenhum rebuild necessário
- ✅ **Auditável:** Implementação espelha byte-a-byte `remote-execution-client.ts` + `hmac.middleware.ts`
- ✅ **Future-proof:** Abre porta para cache de `decryptCommandSecret` (F14), métricas de auth failures (F14), e mTLS (ADR-V2-041)

### Negativas

- ⚠️ **Mudança no bootstrap:** `rawBody` precisa ser preservado via `express.json({ verify })`. Afeta TODAS as rotas. Mitigação: `verify` callback é padrão recomendado pelo express para webhooks HMAC; precedente provável em F12 (Webhooks outbound).
- ⚠️ **Path canônico sensível a ambiente:** Guard aplica regex `^\/api\/v\d+` para normalizar `/api/v1/agents/32/heartbeat` → `/agents/32/heartbeat` (alinhando-se com path relativo que agent assina). Se Nest não aplicar global prefix conforme esperado, regressão silenciosa em produção. Mitigação: Sub-tarefa 6 (sanity local com agent stub) + Sub-tarefa 8 (validação canária contra agent argus em VPS).
- ⚠️ **Decifragem AES-256-GCM por request:** `AgentKeyService.decryptCommandSecret()` roda 30x/min por agent. CPU-light mas não-zero. Otimização futura: cachear secret decifrado em memória (TTL 5min).

---

## Implementação

**Componentes alterados:**

| Arquivo | Mudança | Linhas |
|---------|---------|--------|
| `src/main.ts` | Preservar `rawBody` via `express.json({ verify })` | +23/-2 |
| `src/automation/agents/dto/heartbeat.dto.ts` | Adicionar campos opcionais `cpu`, `mem`, `uptime`, `claudeCodeAvailable`, `tunnelHealthy` | +46/-1 |
| `src/automation/agents/agents.service.ts` | Spread dos novos campos em `dEntidade.dados` | +7 |
| `src/automation/agents/guards/agent-auth.guard.ts` | Reescrita: headers `x-scrumban-*`, validação HMAC, normalização path, códigos de erro estruturados | +144/-27 |
| `src/automation/agents/__tests__/agent-auth.guard.spec.ts` | 13 specs (12 obrigatórios + 1 extra R1) | +391 |
| `agent/src/outbound/hmac-sign.ts` | Restaurar headers `x-scrumban-*`, implementar HMAC de body, atualizar JSDoc | +/-70 |
| `agent/src/outbound/backend-client.ts` | Remover `agentApiKey` da chamada | -1 |
| `agent/__tests__/outbound.spec.ts` | Atualizar specs, adicionar `bindHost` | +5/-2 |

**Testes:**
- Backend `agent-auth.guard.spec.ts`: 13/13 PASS (happy path, format, timestamp skew, nonce replay, agent mismatch, secret missing, HMAC invalid, path normalization)
- Agent outbound specs: 84/84 PASS total, espelhando algoritmo HMAC no backend
- `make build` verde

**Fases F13-F14:**
- **F13:** Implementação (esta task)
- **F14:** Hardening — cache decryption, métricas Prometheus, mTLS design

---

## Decisões Correlatas

- **ADR-V2-033** (contrato HTTP+HMAC): Completada por esta decisão. Guard backend agora valida 100% conforme contrato.
- **ADR-V2-035** (identidade via projectSlug): Reforçada — HMAC do body garante integridade de `projectSlug` em `RUN_CLAUDE_CODE`.
- **ADR-V2-036** (monorepo): Aplicado — commit único cobre backend + agent, versionamento atômico.
- **ADR-V2-037** (claudeSessionId): Não tocada, mas beneficia de HMAC (integridade de sessionId garantida).
- **ADR-V2-041 (futura):** Limpeza de `apiKeyHash` (agora código morto) e avaliação de mTLS.

---

## Notas

- **Débito técnico resolvido:** Comentário em `hmac-sign.ts` linhas 38-43 que justificava protocolo simplificado é removido. Decisão agora é canônica em ADR-V2-040.
- **Backward-compat:** `apiKeyHash` em `dEntidade.dados` preservado como legado (auditoria). Removível em ADR-V2-041.
- **Agent argus em produção:** Nenhuma ação necessária. Bundle deployado anterior aos patches #5 já fala `x-scrumban-*`.

---

**Aprovado por:** Reviewer Agent V2 (Score 8.8/10)
**Implementação:** Sub-tarefas 1-8 do plan, total ~12h (1.5 dia útil)
**Deploy:** Dokploy + validação canária (F13 Automation Backend Task #1)
