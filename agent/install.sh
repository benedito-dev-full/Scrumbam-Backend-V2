#!/usr/bin/env bash
#
# scrumban-agent installer (V2 — F13 Cliente)
#
# Roda na VPS do CEO. Bootstrap idempotente do binário Node+TS do agente.
#
# Uso (produção):
#   sudo bash install.sh \
#     --backend=https://api.scrumban.com.br \
#     --token=<install-token-one-shot> \
#     [--backend-tunnel-host=104.238.205.111] \
#     [--backend-tunnel-port=2025] \
#     [--tunnel-port=20000] \
#     [--allowed-roots=/home/dev/projetos,/srv/projects] \
#     [--bundle-dir=/path/to/agent-bundle] \
#     [--ssh-user=agent] \
#     [--dry-run]
#
# Pre-requisitos:
#   - Ubuntu 22.04+ / Debian 12+
#   - Root (sudo)
#   - Conexão de saída para o backend (HTTPS) e para backendTunnelHost (SSH)
#
# Distribuição do binário (OPÇÃO C do plano):
#   Este install.sh assume que foi extraído de um TARBALL/ZIP do diretório
#   agent/ já buildado (npm run build executado no dev). O install procura
#   o `dist/` em --bundle-dir (default: diretório onde install.sh está).
#   No futuro, --bundle-url pode baixar um tarball de release GitHub.
#
# Idempotência:
#   - User scrumban-agent: criado só se não existe
#   - Chave SSH: gerada só se /etc/scrumban-agent/ssh_key ausente
#   - Handshake: rejeita se config.json já existe (force=--reinstall não suportado)
#   - EnvironmentFile (/etc/scrumban-agent/environment): preservado se já existe
#   - CLAUDE.md (/root/.claude/CLAUDE.md): preservado se já existe
#   - systemd: daemon-reload + restart sempre
#
set -euo pipefail

# ────────────────────────────────────────────────
# Constantes
# ────────────────────────────────────────────────
AGENT_VERSION="0.1.0"
CLAUDE_CODE_MIN_VERSION="2.1.139"
NODE_MIN_MAJOR=20

INSTALL_PREFIX="/opt/scrumban-agent"
CONFIG_DIR="/etc/scrumban-agent"
STATE_DIR="/var/lib/scrumban-agent"
LOG_DIR="/var/log/scrumban-agent"
SERVICE_USER="scrumban-agent"
SERVICE_NAME="scrumban-agent"
CONFIG_FILE="${CONFIG_DIR}/config.json"
SSH_KEY_PATH="${CONFIG_DIR}/ssh_key"
# EnvironmentFile carregado pelo systemd unit. Guarda ANTHROPIC_API_KEY
# (ou ANTHROPIC_AUTH_TOKEN) — sem ela o `claude -p` falha com authentication_error.
ENV_FILE_PATH="${CONFIG_DIR}/environment"
# CLAUDE.md do CEO — root é o owner por padrão (CEO acessa via sudo).
# Trade-off documentado no README §"Onde mora o CLAUDE.md global".
CLAUDE_MD_PATH="/root/.claude/CLAUDE.md"

# ────────────────────────────────────────────────
# Args
# ────────────────────────────────────────────────
BACKEND_URL=""
INSTALL_TOKEN=""
BACKEND_TUNNEL_HOST=""
BACKEND_TUNNEL_PORT="22"
TUNNEL_PORT=""
ALLOWED_ROOTS_RAW="/home/dev/projetos"
BUNDLE_DIR=""
SSH_USER="agent"
DRY_RUN=0

# Resolve diretório onde install.sh está (default para bundle-dir).
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"

usage() {
  cat <<EOF
Uso: sudo bash install.sh [opções]

Obrigatórias:
  --backend=<url>              Base URL do backend V2 (ex: https://api.scrumban.com.br)
  --token=<token>              Install token one-shot do backend

Opcionais:
  --backend-tunnel-host=<host> Host SSH alvo do reverse tunnel (default: derivado de --backend)
  --backend-tunnel-port=<n>    Porta SSH do backend (default: 22)
  --tunnel-port=<n>            Porta local 127.0.0.1 onde o agente escuta (default: vem do backend)
  --allowed-roots=<p1,p2,...>  Raízes permitidas pra projetos (default: /home/dev/projetos)
  --bundle-dir=<dir>           Diretório com dist/ + systemd/ + CLAUDE-md-template.md
                               (default: diretório onde install.sh está)
  --ssh-user=<user>            User SSH no backendTunnelHost (default: agent)
  --dry-run                    Imprime passos sem executar mudanças no sistema
  -h, --help                   Mostra esta mensagem
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend=*) BACKEND_URL="${1#*=}" ;;
    --token=*) INSTALL_TOKEN="${1#*=}" ;;
    --backend-tunnel-host=*) BACKEND_TUNNEL_HOST="${1#*=}" ;;
    --backend-tunnel-port=*) BACKEND_TUNNEL_PORT="${1#*=}" ;;
    --tunnel-port=*) TUNNEL_PORT="${1#*=}" ;;
    --allowed-roots=*) ALLOWED_ROOTS_RAW="${1#*=}" ;;
    --bundle-dir=*) BUNDLE_DIR="${1#*=}" ;;
    --ssh-user=*) SSH_USER="${1#*=}" ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERRO: argumento desconhecido: $1" >&2; usage; exit 2 ;;
  esac
  shift
done

[[ -z "${BACKEND_URL}" ]] && { echo "ERRO: --backend é obrigatório" >&2; usage; exit 2; }
[[ -z "${INSTALL_TOKEN}" ]] && { echo "ERRO: --token é obrigatório" >&2; usage; exit 2; }
[[ -z "${BUNDLE_DIR}" ]] && BUNDLE_DIR="${SCRIPT_DIR}"

# Deriva backendTunnelHost do --backend se não vier explícito.
if [[ -z "${BACKEND_TUNNEL_HOST}" ]]; then
  BACKEND_TUNNEL_HOST="$(echo "${BACKEND_URL}" | sed -E 's#^https?://##' | sed -E 's#/.*$##' | sed -E 's#:[0-9]+$##')"
fi

# ────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────
log() { printf '\033[1;36m>>> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!! %s\033[0m\n' "$*" >&2; }
err() { printf '\033[1;31mERRO: %s\033[0m\n' "$*" >&2; }
ok() { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }

run() {
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    printf '\033[0;35m[dry-run]\033[0m %s\n' "$*"
    return 0
  fi
  # shellcheck disable=SC2294
  # eval é intencional: chamadores passam comandos que contém redirects (`>`,
  # `2>&1`), pipes (`|`) e expansões — `bash -c "$*"` teria o mesmo problema.
  # As strings vêm de constantes hardcoded no script (sem input externo),
  # então o risco de injection é nulo.
  eval "$@"
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    if [[ "${DRY_RUN}" -eq 1 ]]; then
      warn "rodando como não-root em modo --dry-run (ok para smoke test)"
      return 0
    fi
    err "rode como root (sudo bash install.sh ...)"
    exit 1
  fi
}

# Versão semver: retorna 0 se "$1" >= "$2"
semver_ge() {
  # POSIX-friendly: ordena via sort -V e compara primeira linha
  local result
  result="$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n1)"
  [[ "${result}" == "$2" ]]
}

# ────────────────────────────────────────────────
# 1. Validações iniciais
# ────────────────────────────────────────────────
require_root

if ! command -v apt-get >/dev/null 2>&1; then
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    warn "apt-get ausente (provavelmente macOS) — dry-run continua simulando"
  else
    err "este instalador suporta apenas Ubuntu/Debian (apt-get)."
    exit 1
  fi
fi

log "scrumban-agent installer (v${AGENT_VERSION}) — dry-run=${DRY_RUN}"
log "backend=${BACKEND_URL}"
log "backendTunnelHost=${BACKEND_TUNNEL_HOST} port=${BACKEND_TUNNEL_PORT} sshUser=${SSH_USER}"
log "allowedRoots=${ALLOWED_ROOTS_RAW}"
log "bundleDir=${BUNDLE_DIR}"

# Idempotência: rejeita se já instalado (sem --reinstall)
if [[ -f "${CONFIG_FILE}" && "${DRY_RUN}" -eq 0 ]]; then
  err "config já existe em ${CONFIG_FILE}. Rode uninstall.sh antes de reinstalar."
  exit 1
fi

# ────────────────────────────────────────────────
# 2. Pre-flight: clock skew + deps
# ────────────────────────────────────────────────
log "forçando NTP (clock skew quebra HMAC ±5min)..."
run "timedatectl set-ntp true"

log "verificando dependências do sistema..."
run "apt-get update -y >/dev/null"

# Node 20+
if ! command -v node >/dev/null 2>&1 || \
   [[ "$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)" -lt "${NODE_MIN_MAJOR}" ]]; then
  log "instalando Node.js ${NODE_MIN_MAJOR}..."
  run "curl -fsSL https://deb.nodesource.com/setup_${NODE_MIN_MAJOR}.x | bash -"
  run "apt-get install -y nodejs"
fi

command -v autossh >/dev/null 2>&1 || run "apt-get install -y autossh"
command -v jq      >/dev/null 2>&1 || run "apt-get install -y jq"
command -v curl    >/dev/null 2>&1 || run "apt-get install -y curl"

# Claude Code CLI global — necessário para RUN_CLAUDE_CODE
if ! command -v claude >/dev/null 2>&1; then
  log "instalando Claude Code CLI globalmente..."
  if [[ -x /usr/bin/npm ]]; then
    run "/usr/bin/npm install -g @anthropic-ai/claude-code"
  elif command -v npm >/dev/null 2>&1; then
    run "npm install -g @anthropic-ai/claude-code"
  else
    err "npm não encontrado. Instale Node.js antes de continuar."
    exit 1
  fi
fi

# Versão mínima do Claude Code CLI (spike F13: 2.1.139+)
if [[ "${DRY_RUN}" -eq 0 ]]; then
  CLAUDE_VERSION_RAW="$(claude --version 2>/dev/null || echo '')"
  # Output esperado: "2.1.139 (Claude Code)" ou similar — extrai o primeiro token semver-like
  CLAUDE_VERSION="$(echo "${CLAUDE_VERSION_RAW}" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)"
  if [[ -z "${CLAUDE_VERSION}" ]]; then
    err "não foi possível detectar versão do Claude Code CLI (saída: ${CLAUDE_VERSION_RAW})"
    exit 1
  fi
  if ! semver_ge "${CLAUDE_VERSION}" "${CLAUDE_CODE_MIN_VERSION}"; then
    err "Claude Code CLI v${CLAUDE_VERSION} é antiga; mínimo exigido: ${CLAUDE_CODE_MIN_VERSION}"
    err "atualize com: npm install -g @anthropic-ai/claude-code"
    exit 1
  fi
  ok "Claude Code CLI v${CLAUDE_VERSION} OK (>= ${CLAUDE_CODE_MIN_VERSION})"
fi

# ────────────────────────────────────────────────
# 3. User scrumban-agent
# ────────────────────────────────────────────────
log "configurando user ${SERVICE_USER}..."
if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
  run "useradd --system --shell /usr/sbin/nologin --home-dir ${STATE_DIR} --create-home ${SERVICE_USER}"
else
  log "user ${SERVICE_USER} já existe (idempotente)"
fi

# ────────────────────────────────────────────────
# 4. Diretórios
# ────────────────────────────────────────────────
log "criando diretórios..."
run "mkdir -p ${INSTALL_PREFIX}/dist ${CONFIG_DIR} ${STATE_DIR} ${STATE_DIR}/.ssh ${LOG_DIR}"
run "chown -R ${SERVICE_USER}:${SERVICE_USER} ${CONFIG_DIR} ${STATE_DIR} ${LOG_DIR}"
run "chmod 0700 ${CONFIG_DIR}"
run "chmod 0700 ${STATE_DIR}"
run "chmod 0700 ${STATE_DIR}/.ssh"
run "chmod 0750 ${LOG_DIR}"

# ────────────────────────────────────────────────
# 5. Copiar bundle do agente (OPÇÃO C: bundle-relative)
# ────────────────────────────────────────────────
log "copiando bundle do agente de ${BUNDLE_DIR}/dist..."
if [[ ! -d "${BUNDLE_DIR}/dist" ]]; then
  err "${BUNDLE_DIR}/dist não encontrado. Rode 'npm run build' no dev e re-tarball o agent/."
  exit 1
fi
if [[ ! -f "${BUNDLE_DIR}/package.json" ]]; then
  err "${BUNDLE_DIR}/package.json não encontrado no bundle. Inclua-o no tarball."
  exit 1
fi
run "cp -R ${BUNDLE_DIR}/dist/. ${INSTALL_PREFIX}/dist/"
run "cp ${BUNDLE_DIR}/package.json ${INSTALL_PREFIX}/package.json"
if [[ -f "${BUNDLE_DIR}/package-lock.json" ]]; then
  run "cp ${BUNDLE_DIR}/package-lock.json ${INSTALL_PREFIX}/package-lock.json"
fi

# Instala dependências de runtime (zod, etc.). Idempotente: npm ci é determinístico
# quando há package-lock.json; cai pra npm install --omit=dev caso contrário.
log "instalando dependências de runtime do agente..."
if [[ -f "${INSTALL_PREFIX}/package-lock.json" ]]; then
  run "cd ${INSTALL_PREFIX} && npm ci --omit=dev"
else
  run "cd ${INSTALL_PREFIX} && npm install --omit=dev --no-package-lock"
fi

run "chown -R ${SERVICE_USER}:${SERVICE_USER} ${INSTALL_PREFIX}"
run "chmod -R u+rwX,go+rX,go-w ${INSTALL_PREFIX}"

# ────────────────────────────────────────────────
# 6. Par Ed25519 (idempotente)
# ────────────────────────────────────────────────
log "gerando par Ed25519 (se ausente)..."
if [[ "${DRY_RUN}" -eq 0 && ! -f "${SSH_KEY_PATH}" ]]; then
  run "sudo -u ${SERVICE_USER} ssh-keygen -t ed25519 -f ${SSH_KEY_PATH} -N '' -C ${SERVICE_USER}@$(hostname -f 2>/dev/null || hostname)"
fi
run "chown ${SERVICE_USER}:${SERVICE_USER} ${SSH_KEY_PATH} ${SSH_KEY_PATH}.pub"
run "chmod 0600 ${SSH_KEY_PATH}"
run "chmod 0644 ${SSH_KEY_PATH}.pub"

if [[ "${DRY_RUN}" -eq 0 ]]; then
  SSH_PUB_KEY="$(cat "${SSH_KEY_PATH}.pub")"
else
  SSH_PUB_KEY="<dry-run-pubkey-placeholder>"
fi

# ────────────────────────────────────────────────
# 7. Handshake com backend (consome install-token)
# ────────────────────────────────────────────────
log "registrando no backend (consome install-token)..."
HOSTNAME_LOCAL="$(hostname -f 2>/dev/null || hostname)"

if [[ "${DRY_RUN}" -eq 0 ]]; then
  HANDSHAKE_PAYLOAD="$(jq -nc \
    --arg pk "${SSH_PUB_KEY}" \
    --arg hn "${HOSTNAME_LOCAL}" \
    --arg v "${AGENT_VERSION}" \
    --arg t "${INSTALL_TOKEN}" \
    '{installToken: $t, hostname: $hn, agentVersion: $v, publicKeyFingerprint: $pk}')"

  HANDSHAKE_RESP="$(curl -fsSL -X POST "${BACKEND_URL}/api/v1/agents/install" \
    -H "Content-Type: application/json" \
    -d "${HANDSHAKE_PAYLOAD}" 2>&1)" || {
    err "handshake falhou. Resposta do backend: ${HANDSHAKE_RESP}"
    exit 1
  }

  AGENT_ID="$(echo "${HANDSHAKE_RESP}"   | jq -r '.agentId // empty')"
  AGENT_API_KEY="$(echo "${HANDSHAKE_RESP}" | jq -r '.agentApiKey // empty')"
  AGENT_HMAC_SECRET="$(echo "${HANDSHAKE_RESP}" | jq -r '.agentCommandSecret // empty')"
  RESP_TUNNEL_PORT="$(echo "${HANDSHAKE_RESP}" | jq -r '.tunnelPort // empty')"

  if [[ -z "${AGENT_ID}" || -z "${AGENT_API_KEY}" || -z "${AGENT_HMAC_SECRET}" ]]; then
    err "resposta do handshake incompleta (faltam campos)."
    err "Resposta (com secrets redactados): $(echo "${HANDSHAKE_RESP}" | jq 'del(.agentApiKey,.agentCommandSecret)')"
    exit 1
  fi

  # tunnel-port: prioriza arg, depois resposta do backend
  if [[ -z "${TUNNEL_PORT}" ]]; then
    TUNNEL_PORT="${RESP_TUNNEL_PORT}"
  fi
  if [[ -z "${TUNNEL_PORT}" || "${TUNNEL_PORT}" == "null" ]]; then
    err "tunnel-port não definido nem em --tunnel-port nem na resposta do backend."
    exit 1
  fi
else
  AGENT_ID="dry-run-agent-id"
  AGENT_API_KEY="dry-run-api-key"
  AGENT_HMAC_SECRET="dry-run-hmac-secret"
  TUNNEL_PORT="${TUNNEL_PORT:-20000}"
fi

ok "handshake OK — agentId=${AGENT_ID} tunnelPort=${TUNNEL_PORT}"

# ────────────────────────────────────────────────
# 8. Confiar no host do túnel (known_hosts)
# ────────────────────────────────────────────────
log "capturando host key SSH de ${BACKEND_TUNNEL_HOST}:${BACKEND_TUNNEL_PORT}..."
KNOWN_HOSTS_FILE="${STATE_DIR}/.ssh/known_hosts"
# ssh-keyscan imprime o fingerprint no stderr — é o hash que o operador deve
# verificar (TOFU: Trust On First Use). NÃO descartar com 2>/dev/null.
# Redirecionamos stderr para o terminal do operador E para o log de install.
INSTALL_LOG_FILE="${LOG_DIR}/install.log"
if [[ "${DRY_RUN}" -eq 0 ]]; then
  mkdir -p "${LOG_DIR}"
  warn "ssh-keyscan: fingerprint do host abaixo (anote/compare manualmente para TOFU):"
  # stdout (linhas de known_hosts) -> arquivo; stderr (fingerprint) -> tee
  # ao log + terminal do operador. `|| true` mantém continuidade se host down.
  # shellcheck disable=SC2024
  # sudo redireciona stdout do processo do user scrumban-agent; o shellcheck
  # SC2024 aponta "redirecionamento como root" mas aqui é intencional —
  # queremos que o arquivo seja escrito pelo user scrumban-agent.
  sudo -u "${SERVICE_USER}" ssh-keyscan -p "${BACKEND_TUNNEL_PORT}" "${BACKEND_TUNNEL_HOST}" \
    >> "${KNOWN_HOSTS_FILE}" \
    2> >(tee -a "${INSTALL_LOG_FILE}" >&2) \
    || true
else
  printf '\033[0;35m[dry-run]\033[0m ssh-keyscan -p %s %s >> %s (stderr visível ao operador)\n' \
    "${BACKEND_TUNNEL_PORT}" "${BACKEND_TUNNEL_HOST}" "${KNOWN_HOSTS_FILE}"
fi
run "chown ${SERVICE_USER}:${SERVICE_USER} ${KNOWN_HOSTS_FILE}"
run "chmod 0644 ${KNOWN_HOSTS_FILE}"

# ────────────────────────────────────────────────
# 9. Gravar config.json (0600)
# ────────────────────────────────────────────────
log "gravando ${CONFIG_FILE} (modo 0600)..."

# Converte CSV de allowed-roots em array JSON
ALLOWED_ROOTS_JSON="$(echo "${ALLOWED_ROOTS_RAW}" | jq -Rc 'split(",") | map(select(length > 0))')"

if [[ "${DRY_RUN}" -eq 0 ]]; then
  jq -n \
    --arg agentId "${AGENT_ID}" \
    --arg agentApiKey "${AGENT_API_KEY}" \
    --arg agentCommandSecret "${AGENT_HMAC_SECRET}" \
    --arg backendBaseUrl "${BACKEND_URL}" \
    --arg backendTunnelHost "${BACKEND_TUNNEL_HOST}" \
    --argjson backendTunnelPort "${BACKEND_TUNNEL_PORT}" \
    --argjson tunnelPort "${TUNNEL_PORT}" \
    --argjson allowedProjectRoots "${ALLOWED_ROOTS_JSON}" \
    --arg claudeMdPath "${CLAUDE_MD_PATH}" \
    --arg agentSshKeyPath "${SSH_KEY_PATH}" \
    --arg logLevel "info" \
    '{
      agentId: $agentId,
      agentApiKey: $agentApiKey,
      agentCommandSecret: $agentCommandSecret,
      backendBaseUrl: $backendBaseUrl,
      backendTunnelHost: $backendTunnelHost,
      backendTunnelPort: $backendTunnelPort,
      tunnelPort: $tunnelPort,
      allowedProjectRoots: $allowedProjectRoots,
      claudeMdPath: $claudeMdPath,
      agentSshKeyPath: $agentSshKeyPath,
      logLevel: $logLevel
    }' > "${CONFIG_FILE}"
else
  printf '\033[0;35m[dry-run]\033[0m grava JSON config em %s\n' "${CONFIG_FILE}"
fi

run "chown ${SERVICE_USER}:${SERVICE_USER} ${CONFIG_FILE}"
run "chmod 0600 ${CONFIG_FILE}"

# ────────────────────────────────────────────────
# 9b. EnvironmentFile placeholder (ANTHROPIC_API_KEY etc.)
# ────────────────────────────────────────────────
# Sem `ANTHROPIC_API_KEY` (ou `ANTHROPIC_AUTH_TOKEN`), o `claude -p` falha com
# `authentication_error` na primeira execução do RUN_CLAUDE_CODE em produção.
# Criamos um placeholder 0600 owner=scrumban-agent. O operador edita manualmente
# após a instalação. Idempotente: NÃO sobrescreve se já existe.
log "preparando EnvironmentFile em ${ENV_FILE_PATH}..."
if [[ "${DRY_RUN}" -eq 0 && ! -f "${ENV_FILE_PATH}" ]]; then
  cat > "${ENV_FILE_PATH}" <<'ENVEOF'
# /etc/scrumban-agent/environment
#
# Carregado pelo systemd (EnvironmentFile=-/etc/scrumban-agent/environment).
# Variáveis aqui ficam no environment do processo Node, e portanto do `claude`
# que ele invoca via child_process.execFile.
#
# Configure UMA das opções abaixo (descomente e preencha):
#
# ANTHROPIC_API_KEY=sk-ant-...
# ANTHROPIC_AUTH_TOKEN=...
#
# Após preencher, recarregue o serviço:
#   sudo systemctl restart scrumban-agent
ENVEOF
  warn "${ENV_FILE_PATH} criado VAZIO (placeholder). Preencha ANTHROPIC_API_KEY antes do primeiro RUN_CLAUDE_CODE."
elif [[ "${DRY_RUN}" -eq 0 && -f "${ENV_FILE_PATH}" ]]; then
  ok "${ENV_FILE_PATH} já existe — preservado (idempotente)"
else
  printf '\033[0;35m[dry-run]\033[0m cria placeholder em %s\n' "${ENV_FILE_PATH}"
fi
if [[ "${DRY_RUN}" -eq 0 ]]; then
  run "chown ${SERVICE_USER}:${SERVICE_USER} ${ENV_FILE_PATH}"
  run "chmod 0600 ${ENV_FILE_PATH}"
else
  printf '\033[0;35m[dry-run]\033[0m chown/chmod 0600 em %s\n' "${ENV_FILE_PATH}"
fi

# ────────────────────────────────────────────────
# 10. systemd unit
# ────────────────────────────────────────────────
log "instalando systemd unit..."
SYSTEMD_SRC="${BUNDLE_DIR}/systemd/${SERVICE_NAME}.service"
SYSTEMD_DST="/etc/systemd/system/${SERVICE_NAME}.service"

if [[ ! -f "${SYSTEMD_SRC}" ]]; then
  err "${SYSTEMD_SRC} não encontrado no bundle."
  exit 1
fi

run "cp ${SYSTEMD_SRC} ${SYSTEMD_DST}"
run "systemctl daemon-reload"
run "systemctl enable ${SERVICE_NAME}.service >/dev/null 2>&1"
run "systemctl restart ${SERVICE_NAME}.service"

# ────────────────────────────────────────────────
# 11. CLAUDE.md global (template, NÃO popula)
# ────────────────────────────────────────────────
log "verificando CLAUDE.md global em ${CLAUDE_MD_PATH}..."
CLAUDE_MD_DIR="$(dirname "${CLAUDE_MD_PATH}")"
TEMPLATE_SRC="${BUNDLE_DIR}/CLAUDE-md-template.md"

if [[ "${DRY_RUN}" -eq 0 && ! -f "${CLAUDE_MD_PATH}" ]]; then
  if [[ ! -f "${TEMPLATE_SRC}" ]]; then
    warn "${TEMPLATE_SRC} ausente — pulando bootstrap de CLAUDE.md."
  else
    mkdir -p "${CLAUDE_MD_DIR}"
    cp "${TEMPLATE_SRC}" "${CLAUDE_MD_PATH}"
    chmod 0644 "${CLAUDE_MD_PATH}"
    warn "${CLAUDE_MD_PATH} criado a partir de template. Edite manualmente com os projetos reais."
    warn "Risco de prompt injection se você colar conteúdo não-revisado nesse arquivo (ADR-V2-030)."
  fi
elif [[ -f "${CLAUDE_MD_PATH}" ]]; then
  ok "${CLAUDE_MD_PATH} já existe — preservado (idempotente)"
fi

# ────────────────────────────────────────────────
# 12. Heartbeat poll (aguarda agente subir e bater no backend)
# ────────────────────────────────────────────────
if [[ "${DRY_RUN}" -eq 0 ]]; then
  log "aguardando heartbeat do agente (até 60s)..."
  HEARTBEAT_OK=0
  for _ in $(seq 1 30); do
    sleep 2
    if journalctl -u "${SERVICE_NAME}" --since="2 minute ago" --no-pager 2>/dev/null | \
       grep -qE 'heartbeat|scrumban-agent pronto'; then
      HEARTBEAT_OK=1
      break
    fi
    if ! systemctl is-active --quiet "${SERVICE_NAME}.service"; then
      err "service ${SERVICE_NAME} caiu durante boot. Logs:"
      journalctl -u "${SERVICE_NAME}.service" --no-pager | tail -30 >&2
      exit 1
    fi
  done

  if [[ "${HEARTBEAT_OK}" -eq 0 ]]; then
    warn "agente não emitiu heartbeat em 60s. Verifique:"
    warn "  journalctl -u ${SERVICE_NAME}.service -f"
    warn "  systemctl status ${SERVICE_NAME}.service"
  else
    ok "heartbeat detectado nos logs"
  fi
fi

# ────────────────────────────────────────────────
# 13. Resumo final
# ────────────────────────────────────────────────
echo ""
ok "scrumban-agent ${AGENT_VERSION} instalado"
echo ""
echo "  agentId:     ${AGENT_ID}"
echo "  tunnelPort:  127.0.0.1:${TUNNEL_PORT}"
echo "  backendUrl:  ${BACKEND_URL}"
echo "  configFile:  ${CONFIG_FILE} (modo 0600, owner ${SERVICE_USER})"
echo "  service:     ${SERVICE_NAME}.service"
echo "  status:      $(systemctl is-active "${SERVICE_NAME}.service" 2>/dev/null || echo 'unknown')"
echo ""
warn "ATENÇÃO: ANTHROPIC_API_KEY ainda NÃO foi configurada."
warn "Sem ela, o primeiro RUN_CLAUDE_CODE vai falhar com authentication_error."
echo ""
echo "Próximos passos OBRIGATÓRIOS:"
echo "  1. Configure as credenciais do Claude Code:"
echo "       sudo \$EDITOR ${ENV_FILE_PATH}"
echo "     Descomente UMA das linhas e preencha:"
echo "       ANTHROPIC_API_KEY=sk-ant-..."
echo "     OU"
echo "       ANTHROPIC_AUTH_TOKEN=..."
echo "     Depois:  sudo systemctl restart ${SERVICE_NAME}"
echo ""
echo "  2. Edite ${CLAUDE_MD_PATH} com os projetos reais (slugs + caminhos)"
echo "  3. Garanta que os caminhos estão sob: ${ALLOWED_ROOTS_RAW}"
echo "  4. Acompanhe logs:    journalctl -u ${SERVICE_NAME}.service -f"
echo "  5. Para desinstalar:  sudo bash uninstall.sh"
echo ""
