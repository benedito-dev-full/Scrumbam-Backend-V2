/**
 * SEED CANONICO de DClasses — Scrumban-Backend-V2 (Pilar 3 — F1).
 *
 * Composicao do seed (ADR-V2-019: monolitico):
 *   - 45 classes fixas universais Devari-Core (range -1..-110), via spread de
 *     `templates/classes-base-template.ts`.
 *   - 122 classes especificas Scrumban-V2 (range -150..-537), declaradas
 *     neste arquivo, agrupadas por seccao (DEntidade, DVincula, DPedido,
 *     DTabela, DEvento, DTabela secundario, Fases) com comentarios `// === ... ===`.
 *
 * Total: 153 DClasses (ADR-V2-078: -4 status V3 podados — CANCELLED (-446),
 *   DISCARDED (-447), VALIDATING (-448), VALIDATED (-449);
 *   ADR-V2-026: +1 AUDIT_GENERIC; ADR-V2-028: +6 INVITE_*;
 *   ADR-V2-029: +1 PROJECT_TEAM_LINK; ADR-V2-033: +2 AGENT_SESSION_*;
 *   ADR-V2-FOLDERS-001: +1 FOLDER, +1 FOLDER_PROJECT_LINK;
 *   ADR-V2-047: +1 PHASE;
 *   ADR-V2-051: +2 BOOKMARK/SPACE_PRIVATE_MEMBER, +3 SPACE/FOLDER/LIST;
 *   GAP-04: +1 DOC;
 *   GAP-COMMENT: +1 TASK_COMMENT;
 *   Frente B Nexus IA: +1 GEMINI_API_KEY (-481), +1 AI_CHAT_MESSAGE (-508);
 *   Frente B Nexus IA multi-provider: +3 CLAUDE_API_KEY (-482),
 *     OPENAI_API_KEY (-483), AI_PROVIDER_PREF (-484);
 *   ADR-V2-058: +1 PROJECT_REF (-158, DEntidade-espelho de DProject em DVincula);
 *   ADR-V2-061 (proposto): +2 TEMPLATE_LIST (-401), TEMPLATE_SPACE (-402) —
 *     feature Templates de Lista/Espaco via deep-clone do motor cloneTree;
 *   ADR-V2-070 (proposto): +1 DELAY_JUSTIFICATION (-503, DEvento de atraso),
 *     +1 DELAY_REASON (-530, agrupador) e +7 folhas de motivo (-531..-537) —
 *     feature Justificativa de Atraso de Tarefas via DEvento + DClasse;
 *   ADR-V2-077 (proposto): +1 SESSION (-485, DTabela — 1 linha por sessao,
 *     multi-device) e +4 DEventos de seguranca de sessao: SESSION_CREATED
 *     (-504), SESSION_REVOKED (-509), SECURITY_REFRESH_REUSE_DETECTED (-523),
 *     SECURITY_ALL_SESSIONS_REVOKED (-524)).
 *
 * Validacao automatica:
 *   `validateHierarchy(classes)` e chamado no topo deste modulo. Qualquer
 *   violacao (ciclo, idPai inexistente, sequestro de chave canonica
 *   reservada, chave duplicada/positiva) lanca Error em time de import,
 *   ANTES de qualquer escrita no banco. Isso garante que problemas
 *   estruturais sao detectados em `tsc`/`jest`/CI, nao em producao.
 *
 * Idempotencia (ADR-V2-020):
 *   O `seed-runner.ts` consome este array e faz UPSERT atomico em
 *   `prisma.$transaction`. Re-execucao do seed e segura.
 *
 * Convencao de chaves negativas (devari-polymorphic-engine.md §3):
 *   - Seeds = chaves NEGATIVAS. Runtime = chaves POSITIVAS.
 *   - Range -1..-110 reservado para fixas universais.
 *   - Range -150..-537 alocado para Scrumban-V2 (este arquivo).
 *   - Chaves -45/-47/-49/-50 sao do template fintech (Dinpayz) — bloqueadas
 *     pelo validador como sequestro caso sejam usadas aqui.
 *
 * @see prisma/seeds/validate-hierarchy.ts (validador puro)
 * @see prisma/seeds/seed-runner.ts (runner UPSERT)
 * @see templates/classes-base-template.ts (45 classes fixas)
 * @see docs/plano/00-PLANO-MESTRE.md §3 (auditoria das 128 classes)
 * @see docs/decisions/ADR-V2-019-seed-monolitico.md
 */

import { classesFixas, type DClasseSeed } from '../../templates/classes-base-template';
import { validateHierarchy } from './validate-hierarchy';

/**
 * Helper local — reduz repeticao na declaracao de classes especificas.
 * Mesmas convencoes do helper `fixa()` do template (todos flags = false,
 * tableFields=null, baseFields=false).
 *
 * @param chave - PK negativa unica (range -150..-537 para Scrumban-V2).
 * @param codigo - codigo curto UPPER_SNAKE_CASE (ex: 'USER', 'INBOX').
 * @param nome - nome descritivo para UI.
 * @param idPai - chave da DClasse pai (deve existir no array final).
 * @param agrupamento - true se agrupador (no intermediario), false se folha.
 * @returns DClasseSeed com defaults seguros.
 */
function esp(
  chave: number,
  codigo: string,
  nome: string,
  idPai: number,
  agrupamento = false,
): DClasseSeed {
  return {
    chave,
    codigo,
    nome,
    idPai,
    agrupamento,
    inativo: false,
    excluido: false,
    excluivel: false,
    editavel: false,
    tableFields: null,
    baseFields: false,
  };
}

/**
 * Array de classes especificas Scrumban-V2 (126 entradas).
 *
 * Ordem:
 *   1. DEntidade — 9 (sub-tipos de Pessoa: USER, PLATFORM_SCRUMBAN,
 *      ORGANIZATION, SCRUMBAN_PROJECT, SCRUMBAN_TASK, AGENT, TEAM, FOLDER,
 *      PROJECT_REF).
 *      ADR-V2-FOLDERS-001 (+1 FOLDER). ADR-V2-058 (+1 PROJECT_REF).
 *   2. DVincula — 15 (relacoes Org-User, Project-User, Team, Project-Agent,
 *      Telegram, Project-Team, Folder-Project, Bookmark, Space-Private-Member).
 *      ADR-V2-029 (+1 PROJECT_TEAM_LINK).
 *      ADR-V2-FOLDERS-001 (+1 FOLDER_PROJECT_LINK).
 *      ADR-V2-051 (+2 BOOKMARK, SPACE_PRIVATE_MEMBER).
 *   3. Fases (DTask especializacao) — 1 (PHASE).
 *      ADR-V2-047 (+1 PHASE — agrupador hierarquico de DTask via idPai).
 *   4. DProject — hierarquia Space/Folder/List + Templates — 5 (ADR-V2-051,
 *      ADR-V2-061).
 *      (+3 SPACE, FOLDER, LIST; +2 TEMPLATE_LIST, TEMPLATE_SPACE).
 *   5. DPedido — 4 (EXECUTION + EXEC_LOW/MED/HIGH para Pilar 1 / F6).
 *   6. DTabela principal — 35 (PRIORITY, TASK_TYPE, STATUS V3,
 *      CHANNEL, WEBHOOK, API_KEY, MCP_KEY, INSTALL_TOKEN, PAIRING_TOKEN,
 *      ISSUE_COUNTER, DOC).
 *      GAP-04 (+1 DOC).
 *      ADR-V2-060 (-1 SPRINT — hard delete; range -400..-419 liberado).
 *   7. DEvento — 16 (AUDIT_GENERIC, NOTIFICATION, WEBHOOK_ATTEMPT,
 *      AGENT_HEARTBEAT, TELEGRAM_*, MCP_CALL, EXECUTION_LOG, audit logs,
 *      INVITE_LIFECYCLE, AGENT_SESSION_CREATED, AGENT_SESSION_RESUMED).
 *      ADR-V2-026 (+1 AUDIT_GENERIC) + ADR-V2-027 (rename
 *      PROJECT_DELETED → PROJECT_LIFECYCLE; ORG_DELETED → ORG_LIFECYCLE)
 *      + ADR-V2-028 (+1 INVITE_LIFECYCLE)
 *      + ADR-V2-033 (+2 AGENT_SESSION_CREATED/RESUMED).
 *   8. DTabela secundario — 21 (AGENT_STATUS, EXEC_STATUS, RISK_LEVEL,
 *      INVITE_TOKEN, INVITE_STATUS_*).
 *      ADR-V2-028 (+5 INVITE_TOKEN, INVITE_STATUS_PENDING/ACCEPTED/EXPIRED/REVOKED).
 *
 * Soma: 9 + 15 + 1 + 5 + 4 + 35 + 16 + 21 = 106.
 * Com GAP-COMMENT: +1 = 107.
 * Com ADR-V2-061 Templates (+2 TEMPLATE_LIST, TEMPLATE_SPACE em item 4): = 109.
 * (item 4 DProject subiu de 3 para 5 com ADR-V2-061.)
 * (DEntidade subiu de 8 para 9 com ADR-V2-058 PROJECT_REF -158.)
 * (ADR-V2-060: SPRINT -400 removido — item 6 caiu de 36 para 35.)
 * NOTA: Frente B Nexus IA (GEMINI_API_KEY, AI_CHAT_MESSAGE) ja contabilizada
 *   nos itens 6/8 desta soma — o total runtime e 109 (validado pelo seed-runner).
 */
const classesEspecificas: DClasseSeed[] = [
  // === DEntidade — sub-tipos de Pessoa (5) + DProject/DTask (2) + FOLDER (1) + PROJECT_REF (1) ===
  // Filhos de PESSOAS (-43) ou ENTIDADES (-37)
  esp(-150, 'USER', 'Usuario Scrumban', -43),
  esp(-151, 'PLATFORM_SCRUMBAN', 'Platform Scrumban', -43),
  esp(-152, 'ORGANIZATION', 'Organizacao', -43),
  esp(-153, 'SCRUMBAN_PROJECT', 'Projeto Scrumban', -37),
  esp(-154, 'SCRUMBAN_TASK', 'Task Scrumban', -37),
  // ADR-V2-FOLDERS-001: pasta agrupadora de projetos por organizacao.
  // Folder e DEntidade (nao DTabela) porque tem lifecycle proprio (CRUD,
  // soft-delete com cascata de vinculos) e e cidada de primeira classe da
  // navegacao (/workspace/folders/:id). idEstab=orgId estabelece o tenant.
  esp(-155, 'FOLDER', 'Pasta (agrupamento de projetos)', -37),
  esp(-156, 'AGENT', 'Agente Claude Code', -43),
  // ADR-V2-058: DEntidade-espelho 1:1 do DProject — handle canonico do projeto
  // dentro do grafo DVincula. A FK de DVincula (idLocEscritu/idEntidade) aponta
  // para DEntidade.chave; DProject tem sequencia propria e NUNCA deveria estar
  // em DVincula. Cada DProject ganha um PROJECT_REF espelho (mesmo idEstab,
  // dados.projectId=P; DProject.dados.entidadeRefId=E) e todos os vinculos
  // project-scoped (-171/-172/-173, -182, -183, -188) passam a apontar para
  // este espelho. Resolve o 500 de FK e a colisao silenciosa de IDs. Detalhe
  // interno — NAO exposto via REST proprio. Status do ADR: pendente CEO.
  esp(-158, 'PROJECT_REF', 'Referencia de Projeto (espelho DVincula)', -37),
  esp(-180, 'TEAM', 'Time', -43),

  // === DVincula — relacoes (12) ===
  // Filhos de ENTIDADES (-37) por convencao do plano-mestre §3.2
  esp(-160, 'ORG_USER_LINK', 'Vinculo Org-Usuario', -37, true),
  esp(-161, 'ORG_ROLE_ADMIN', 'Org Role: ADMIN', -160),
  esp(-162, 'ORG_ROLE_MEMBER', 'Org Role: MEMBER', -160),
  esp(-163, 'ORG_ROLE_VIEWER', 'Org Role: VIEWER', -160),
  esp(-170, 'PROJECT_USER_LINK', 'Vinculo Project-Usuario', -37, true),
  esp(-171, 'PROJECT_ROLE_MANAGER', 'Project Role: MANAGER', -170),
  esp(-172, 'PROJECT_ROLE_MEMBER', 'Project Role: MEMBER', -170),
  esp(-173, 'PROJECT_ROLE_VIEWER', 'Project Role: VIEWER', -170),
  esp(-181, 'TEAM_MEMBERSHIP', 'Vinculo Team-User', -37),
  // ADR-V2-029: vincula Project a Team via DVincula (idLocEscritu=teamId,
  // idEntidade=projectId). N:1 (1 projeto pertence a no maximo 1 time, valida-
  // do no service). Permite que projetos sejam orfaos (sem time) — vinculo
  // ausente = teamId null no response.
  esp(-182, 'PROJECT_TEAM_LINK', 'Vinculo Project-Team', -37),
  // ADR-V2-FOLDERS-001: vincula DProject a DEntidade-Folder (-155) via DVincula.
  // Padrao espelhado de PROJECT_TEAM_LINK (-182) — idLocEscritu=folderId (DONO
  // do vinculo), idEntidade=projectId. Cardinalidade N:1 (1 projeto pertence
  // a no maximo 1 folder ativo, validado em service — nao ha unique parcial).
  // Soft-delete por projeto = move para "limbo" (CEO Q4).
  esp(-183, 'FOLDER_PROJECT_LINK', 'Vinculo Folder-Project', -37),
  esp(-185, 'PROJECT_AGENT', 'Vinculo Project-Agent', -37),
  esp(-186, 'TELEGRAM_LINK', 'Vinculo User-Telegram chat', -37),
  // ADR-V2-051 + GAP-10: vinculos adicionais de entidade.
  // -187 BOOKMARK: favorito/bookmark de qualquer entidade (DProject, DTask, etc.)
  // armazenado como DVincula (idLocEscritu=userId, idEntidade=bookmarkedId).
  // -188 SPACE_PRIVATE_MEMBER: membro explicitamente adicionado a Space privado
  // (-350), espelhando o padrao de PROJECT_USER_LINK (-170) para Spaces.
  esp(-187, 'BOOKMARK', 'Favorito/Bookmark', -37),
  esp(-188, 'SPACE_PRIVATE_MEMBER', 'Membro de Space privado', -37),

  // === Fases (-200..-299) — hierarquia de tasks via DTask.idPai (ADR-V2-047) ===
  // PHASE eh DTask agrupadora (idClasse=-200), filha de ENTIDADES (-37), mesmo
  // pai de SCRUMBAN_TASK (-154). Forma arvore via DTask.idPai → DTask.chave
  // (self-FK). Folhas executaveis sao SCRUMBAN_TASK; intermediarios sao PHASE.
  // Cardinalidade 1:1 garantida pelo schema (coluna escalar). Range -200..-299
  // reservado para futuras especializacoes de DTask (BLOCK, MILESTONE, EPIC).
  esp(-200, 'PHASE', 'Fase (agrupador de tasks)', -37, true),

  // === DProject — hierarquia Space/Folder/List (ADR-V2-051) ===
  // Filhos de ENTIDADES (-37) — Space, Folder e List sao entidades de primeira
  // classe com lifecycle proprio (CRUD, soft-delete com cascata de vinculos),
  // cidadaos da navegacao do workspace (/workspace/spaces/:id/folders/:id/lists/:id).
  // -350 SPACE: espaco de trabalho raiz (agrupador de Folders/Lists).
  // -351 FOLDER: pasta agrupadora dentro de um Space.
  // -352 LIST: lista de tasks (Board/Backlog), folha da hierarquia Space>Folder>List.
  esp(-350, 'SPACE', 'Espaco de trabalho', -37),
  esp(-351, 'FOLDER', 'Pasta agrupadora', -37),
  esp(-352, 'LIST', 'Lista de tasks (Board/Backlog)', -37),

  // === DProject — Templates de Lista/Espaco (Feature Templates) ===
  // Filhos de ENTIDADES (-37). Template = DProject marcado por idClasse dedicado
  // (diferencia template de projeto real). Ao materializar via POST /projects/:id/from-template,
  // o cloneTree remapeia -401 -> -352 (LIST) e -402 -> -350 (SPACE). Alcance: global =
  // idEstab NULL (todas as orgs, criado por seed/plataforma); por-org = idEstab=org.
  // Categoria em dados.categoria. Range -401..-419 liberado por ADR-V2-060. ADR-V2-061 (proposto).
  esp(-401, 'TEMPLATE_LIST', 'Template de Lista', -37),
  esp(-402, 'TEMPLATE_SPACE', 'Template de Espaco', -37),

  // === DPedido — execucoes Claude Code (4 — Pilar 1 prep para F6) ===
  // Filho de PEDIDOS (-20)
  esp(-300, 'EXECUTION', 'Execucao Claude Code', -20, true),
  esp(-301, 'EXEC_LOW', 'Execucao risco LOW', -300),
  esp(-302, 'EXEC_MED', 'Execucao risco MEDIUM', -300),
  esp(-303, 'EXEC_HIGH', 'Execucao risco HIGH', -300),

  // === DTabela — lookups e folhas runtime principais (32) ===
  // Filhos de TABELAS (-51) ou STATUS (-52) conforme plano-mestre §3.2
  // SPRINT (-400) REMOVIDO (ADR-V2-060 — hard delete de Sprint; range -400..-419 liberado).
  esp(-420, 'PRIORITY', 'Priority (agrupador)', -51, true),
  esp(-421, 'HIGH', 'Priority HIGH', -420),
  esp(-422, 'MEDIUM', 'Priority MEDIUM', -420),
  esp(-423, 'LOW', 'Priority LOW', -420),
  esp(-424, 'URGENT', 'Priority URGENT', -420),
  esp(-430, 'TASK_TYPE', 'Task Type (agrupador)', -51, true),
  esp(-431, 'FEATURE', 'Task FEATURE', -430),
  esp(-432, 'BUG', 'Task BUG', -430),
  esp(-433, 'IMPROVEMENT', 'Task IMPROVEMENT', -430),
  esp(-434, 'REVIEW', 'Task REVIEW', -430),
  esp(-435, 'EXPLAIN', 'Task EXPLAIN', -430),
  // Status V3 Intention — 5 canonicos (poda 9 -> 5, ADR-V2-078).
  // As chaves -446 (CANCELLED), -447 (DISCARDED), -448 (VALIDATING) e
  // -449 (VALIDATED) foram REMOVIDAS: vieram de um PRD legado nunca
  // implementado (ZERO produtores em producao) e o enum do MCP as expunha,
  // fazendo IAs prenderem tasks humanas em VALIDATING. NAO reintroduzir —
  // fonte unica em `src/tasks/constants/task-status.const.ts`.
  // As chaves -446..-449 ficam RESERVADAS (nao reutilizar para outra coisa:
  // ainda existem linhas de DTabela em producao apontando para elas ate a
  // migracao de dados rodar).
  esp(-440, 'STATUS_INTENTION_V3', 'Status V3 (agrupador)', -52, true),
  esp(-441, 'INBOX', 'Status INBOX', -440),
  esp(-442, 'READY', 'Status READY', -440),
  esp(-443, 'EXECUTING', 'Status EXECUTING', -440),
  esp(-444, 'DONE', 'Status DONE', -440),
  esp(-445, 'FAILED', 'Status FAILED', -440),
  esp(-450, 'CHANNEL', 'Canal (agrupador)', -52, true),
  esp(-451, 'WEB', 'Canal WEB', -450),
  esp(-452, 'WHATSAPP', 'Canal WHATSAPP', -450),
  esp(-453, 'EMAIL', 'Canal EMAIL', -450),
  esp(-454, 'SLACK', 'Canal SLACK', -450),
  esp(-455, 'API', 'Canal API', -450),
  esp(-456, 'TELEGRAM', 'Canal TELEGRAM', -450),
  esp(-470, 'WEBHOOK', 'Configuracao de Webhook outbound', -52),
  esp(-471, 'API_KEY', 'API Key por projeto', -52),
  esp(-472, 'MCP_KEY', 'MCP Key por usuario', -52),
  esp(-473, 'INSTALL_TOKEN', 'Token install one-shot Argus', -52),
  esp(-474, 'PAIRING_TOKEN', 'Token pairing Telegram', -52),
  esp(-475, 'ISSUE_COUNTER', 'Contador DEV-N por team', -52),
  // Frente B (Nexus IA Chat — v1): chave de API global do provider Gemini,
  // armazenada como DTabela canônica (ADR-V2-004). v1: 1 chave global
  // (dEntidadeId=null), com fallback para process.env.GOOGLE_API_KEY no dev.
  // dados.plaintext + dados.hash + dados.prefix; v2 multi-tenant trocara
  // para dEntidadeId=orgId. Ver src/ai/README.md (R-2 plaintext aceito v1).
  esp(-481, 'GEMINI_API_KEY', 'Chave Gemini (provider IA Nexus)', -52),
  // Frente B (Nexus IA Chat — multi-provider): chaves de API por provider e
  // preferencia de modelo padrao da org. Mesmo padrao de -481 GEMINI_API_KEY
  // (DTabela canonica, ADR-V2-004). dados.plaintext + dados.hash + dados.prefix.
  esp(-482, 'CLAUDE_API_KEY', 'Chave Anthropic Claude (provider IA Nexus)', -52),
  esp(-483, 'OPENAI_API_KEY', 'Chave OpenAI (provider IA Nexus)', -52),
  esp(-484, 'AI_PROVIDER_PREF', 'Preferencia de provider/modelo padrao da org (Nexus)', -52),
  // ADR-V2-077 (F3 — sessoes multi-device): UMA LINHA DE DTabela POR SESSAO.
  //
  // Precedente direto: ADR-V2-004 — API Keys (-471) e MCP Keys (-472) ja sao
  // credenciais de longa duracao vivendo em DTabela. Sessao segue o MESMO
  // padrao: ZERO tabela nova (ADR-V2-001).
  //
  // Ate a F2, o refresh token vivia num SLOT UNICO em `DUserGroup.dados`. Logar
  // num 2o device sobrescrevia o slot do 1o — e quando o 1o tentava renovar,
  // o hash desconhecido era classificado como REUSE ATTACK e a sessao era
  // revogada. Ou seja: o sistema derrubava o usuario e ainda o acusava de roubo.
  // Uma linha por sessao mata isso na raiz (e da enumeracao/revoke individual,
  // requisito de OWASP ASVS Session Management).
  //
  // Layout da linha (ver SessionService):
  //   codigo      = sha256(refreshToken CORRENTE)   ← lookup indexado
  //   nome        = familyId (uuid)                 ← familia RFC 9700
  //   descricao   = device label (User-Agent resumido)
  //   dEntidadeId = DEntidade (-150) do usuario     ← listagem/revoke por user
  //   metaDados   = { userGroupId, jti, prevHash, prevHashValidUntil, issuedAt,
  //                   idleExpiresAt, absoluteExpiresAt, lastUsedAt, ip,
  //                   userAgent, revokedAt, revokedReason }
  //   excluido    = revogada (logout / replay / eviccao LRU / expiracao)
  //
  // SEGURANCA: `codigo` e `metaDados` contem hashes de credencial → esta classe
  // e DENYLISTED no endpoint generico /tabelas (Pilar 2). Ver TabelaService.
  esp(-485, 'SESSION', 'Sessao de usuario (refresh token multi-device)', -52),
  // GAP-04: documento rico associado a qualquer entidade (DProject, DTask, Space, etc.).
  // Conteudo rico (Markdown/JSON) armazenado em dados.content (campo Json de DTabela).
  // Uso: DTabela (idClasse=-353, dEntidadeId=entidadeAlvo).
  esp(-353, 'DOC', 'Documento rico (conteudo em dados.content)', -51),

  // === DEvento — auditoria (13) ===
  // Filhos de EVENTOS (-3) — audit trail polimorfico
  esp(-489, 'AUDIT_GENERIC', 'Audit generico (fallback sem categoria semantica)', -3),
  esp(-490, 'NOTIFICATION', 'Notificacao in-app', -3),
  esp(-491, 'WEBHOOK_ATTEMPT', 'Tentativa de Webhook outbound', -3),
  esp(-492, 'AGENT_HEARTBEAT', 'Heartbeat de Agent', -3),
  esp(-493, 'TELEGRAM_MSG_IN', 'Mensagem Telegram recebida', -3),
  esp(-494, 'TELEGRAM_MSG_OUT', 'Mensagem Telegram enviada', -3),
  esp(-495, 'MCP_CALL', 'Chamada MCP auditada', -3),
  esp(-496, 'EXECUTION_LOG', 'Log de execucao Claude', -3),
  esp(-497, 'TASK_CREATED', 'Audit: task criada', -3),
  esp(-498, 'TASK_STATUS_CHANGED', 'Audit: mudanca de status', -3),
  esp(
    -499,
    'PROJECT_LIFECYCLE',
    'Audit: lifecycle de projeto (created/updated/deleted via metaDados._meta.action)',
    -3,
  ),
  esp(
    -500,
    'ORG_LIFECYCLE',
    'Audit: lifecycle de organizacao (created/updated/deleted via metaDados._meta.action)',
    -3,
  ),
  esp(-501, 'USER_LOGIN', 'Audit: login', -3),
  esp(
    -502,
    'INVITE_LIFECYCLE',
    'Audit: lifecycle de convite (sent/accepted/expired/revoked via metaDados._meta.action)',
    -3,
  ),
  // ADR-V2-070 (proposto): Justificativa de atraso de tarefa. Fato datado e
  // versionavel via DEvento (ADR-V2-008). idEntidade=autorId (DEntidade do
  // responsavel), identificadorExterno=taskId (SEM FK — taskId NAO cabe na FK
  // idEntidade→DEntidade, ver ADR-V2-058), metaDados={motivoClasse, texto,
  // projetoId, autorId, delayDays, delayKind, version, supersededBy}. "1
  // vigente + historico" via supersede: editar marca a linha anterior
  // excluido=true e insere nova (vigente = unica excluido=false).
  esp(-503, 'DELAY_JUSTIFICATION', 'Justificativa de atraso de tarefa', -3),
  // ADR-V2-033 (sub-tarefa 2.1): DEventos de session lifecycle Claude Code.
  // Materializados pelo handler de `POST /agents/:id/execution-result` quando
  // o agente V2 reporta `claudeSessionId` apos uma execucao concluir.
  // idPai=-3 (EVENTOS) seguindo a convencao consistente dos demais DEventos
  // de agent (-489 AUDIT_GENERIC, -492 AGENT_HEARTBEAT, -496 EXECUTION_LOG).
  // NAO ha agrupador intermediario para eventos agent — todos descendem
  // diretamente de -3, mantendo o padrao polimorfico DEvento+idClasse.
  esp(-505, 'AGENT_SESSION_CREATED', 'Sessao Claude Code criada', -3),
  esp(-506, 'AGENT_SESSION_RESUMED', 'Sessao Claude Code retomada', -3),
  // GAP-COMMENT (Fase 1 — ia-tools-backend): comentários polimórficos em
  // tasks/projects/folders/lists via DEvento (ADR-V2-001 respeitado — zero
  // tabela nova). idClasse=-507 serve polimorfico (nome histórico TASK_COMMENT,
  // reusado para todos os tipos na v1). Ver `src/comments/README.md` para detalhes.
  esp(-507, 'TASK_COMMENT', 'Comentario textual em qualquer alvo (task|project|folder|list)', -3),
  // Frente B (Nexus IA Chat — v1): mensagens polimorficas user/assistant do
  // chat IA persistidas em DEvento. identificadorExterno=entidadeId do user
  // na v1 (conversa unica); na v2 vira UUID por conversa SEM mudanca de schema.
  // descricao=conteudo da mensagem. metaDados={role, model, tokens?, toolCalls?}.
  // ZERO tabela nova (ADR-V2-001). Ver src/ai/README.md.
  esp(-508, 'AI_CHAT_MESSAGE', 'Mensagem do chat IA Nexus (polimorfica user/assistant)', -3),

  // === DEvento — ciclo de vida de SESSAO e seguranca de auth (4 — ADR-V2-077) ===
  // F3 do plano `plan-sessao-auth-hardening.md`. Ate aqui TODO evento de auth
  // era gravado como -501 USER_LOGIN com `descricao` distinguindo o caso — o
  // que torna impossivel alertar/agregar por tipo (o evento de REPLAY REAL fica
  // afogado no volume de logins). Estes 4 idClasses dao identidade propria aos
  // fatos de sessao. idPai=-3 (EVENTOS), como todos os demais DEventos.
  //
  // -523 é o sinal que a Fase 1 aprendeu a medir com precisao: depois da grace
  // window, um SECURITY_REFRESH_REUSE_DETECTED so aparece em replay REAL.
  // -524 é a ESCALACAO do RFC 9700: replay de token de uma sessao JA revogada
  // por replay = credencial vazada → derruba TODAS as sessoes do usuario.
  esp(-504, 'SESSION_CREATED', 'Sessao de usuario criada (login/register/convite)', -3),
  esp(-509, 'SESSION_REVOKED', 'Sessao de usuario revogada (logout/admin/eviccao/expiracao)', -3),
  esp(
    -523,
    'SECURITY_REFRESH_REUSE_DETECTED',
    'Replay REAL de refresh token (fora da grace) — familia revogada',
    -3,
  ),
  esp(
    -524,
    'SECURITY_ALL_SESSIONS_REVOKED',
    'Escalacao RFC 9700: replay de sessao ja revogada — TODAS as sessoes do usuario revogadas',
    -3,
  ),

  // === DTabela — status lookups secundarios (21) ===
  // Filhos de STATUS (-52)
  esp(-510, 'AGENT_STATUS_ONLINE', 'Agent: ONLINE', -52),
  esp(-511, 'AGENT_STATUS_OFFLINE', 'Agent: OFFLINE', -52),
  esp(-512, 'AGENT_STATUS_PENDING_INSTALL', 'Agent: PENDING_INSTALL', -52),
  esp(-513, 'AGENT_STATUS_NEVER_CONNECTED', 'Agent: NEVER_CONNECTED', -52),
  esp(-514, 'EXEC_STATUS_QUEUED', 'Exec: QUEUED', -52),
  esp(-515, 'EXEC_STATUS_AWAITING_APPROVAL', 'Exec: AWAITING_APPROVAL', -52),
  esp(-516, 'EXEC_STATUS_APPROVED', 'Exec: APPROVED', -52),
  esp(-517, 'EXEC_STATUS_REJECTED', 'Exec: REJECTED', -52),
  esp(-518, 'EXEC_STATUS_RUNNING', 'Exec: RUNNING', -52),
  esp(-519, 'EXEC_STATUS_SUCCESS', 'Exec: SUCCESS', -52),
  esp(-520, 'EXEC_STATUS_FAILED', 'Exec: FAILED', -52),
  esp(-521, 'EXEC_STATUS_EXPIRED', 'Exec: EXPIRED', -52),
  esp(-522, 'EXEC_STATUS_ROLLED_BACK', 'Exec: ROLLED_BACK', -52),
  esp(-525, 'RISK_LEVEL_LOW', 'Risk: LOW', -52),
  esp(-526, 'RISK_LEVEL_MEDIUM', 'Risk: MEDIUM', -52),
  esp(-527, 'RISK_LEVEL_HIGH', 'Risk: HIGH', -52),

  // === DClasse — motivos de atraso (agrupador + 7 folhas — ADR-V2-070) ===
  // Vocabulario FIXO do radio de justificativa (Pilar 3). O agrupador -530
  // pende de TABELAS (-51); as folhas pendem de -530. Populado no frontend
  // via `GET /classes?idPai=-530` (Pilar 2 — endpoint generico, zero
  // controller novo). Evolucao futura (motivos custom por org) = linhas
  // POSITIVAS de DTabela sob a familia DELAY_REASON, sem mudanca de schema.
  esp(-530, 'DELAY_REASON', 'Motivo de atraso (agrupador)', -51, true),
  esp(-531, 'DELAY_DEPENDENCY', 'Dependencia nao entregue', -530),
  esp(-532, 'DELAY_EXTERNAL_BLOCK', 'Bloqueio externo / aguardando cliente', -530),
  esp(-533, 'DELAY_UNDERESTIMATED', 'Subestimei o esforco', -530),
  esp(-534, 'DELAY_PRIORITY_SHIFT', 'Prioridade mudou no meio', -530),
  esp(-535, 'DELAY_TECHNICAL', 'Problema tecnico / bug', -530),
  esp(-536, 'DELAY_OVERLOAD', 'Sobrecarga (tarefas demais)', -530),
  esp(-537, 'DELAY_OTHER', 'Outro', -530),

  // === DTabela — convite por email (5 — ADR-V2-028) ===
  // Filhos de STATUS (-52)
  // -476 INVITE_TOKEN: armazenamento do token (hash SHA-256 em metaDados).
  // -477..-480 sao lookups reservados; status atual fica em metaDados.status.
  esp(-476, 'INVITE_TOKEN', 'Token de convite para nova org', -52),
  esp(-477, 'INVITE_STATUS_PENDING', 'Convite: PENDING', -52),
  esp(-478, 'INVITE_STATUS_ACCEPTED', 'Convite: ACCEPTED', -52),
  esp(-479, 'INVITE_STATUS_EXPIRED', 'Convite: EXPIRED', -52),
  esp(-480, 'INVITE_STATUS_REVOKED', 'Convite: REVOKED', -52),
];

/**
 * Array completo do seed (45 fixas + 126 especificas = 171 DClasses).
 * Validado automaticamente em time de import (validateHierarchy abaixo).
 */
export const classes: DClasseSeed[] = [...classesFixas, ...classesEspecificas];

/**
 * Contagens explicitas exportadas — usadas pelo seed-runner para log
 * estruturado e por testes anti-regressao.
 */
export const COUNTS = Object.freeze({
  fixas: classesFixas.length,
  especificas: classesEspecificas.length,
  total: classes.length,
});

// =============================================================================
// VALIDACAO ESTATICA EM TIME DE IMPORT
// =============================================================================
// Roda no `tsc`, no `jest` (qualquer teste que importe esse arquivo) e no
// `prisma db seed`. Se quebrar: erro fatal antes de tocar o banco.
validateHierarchy(classes);

export { classesEspecificas };
