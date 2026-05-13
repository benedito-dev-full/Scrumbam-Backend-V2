#!/usr/bin/env bash
#
# scrumban-agent uninstaller (V2 — F13 Cliente)
#
# Remove TUDO: service, binário, config, state, user.
# Idempotente: pode rodar várias vezes sem quebrar.
#
# Uso:
#   sudo bash uninstall.sh         # com confirmação interativa
#   sudo bash uninstall.sh --yes   # sem prompt
#
set -euo pipefail

SERVICE_NAME="scrumban-agent"
SERVICE_USER="scrumban-agent"

INSTALL_PREFIX="/opt/scrumban-agent"
CONFIG_DIR="/etc/scrumban-agent"
STATE_DIR="/var/lib/scrumban-agent"
LOG_DIR="/var/log/scrumban-agent"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

log() { printf '\033[1;36m>>> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!! %s\033[0m\n' "$*" >&2; }
err() { printf '\033[1;31mERRO: %s\033[0m\n' "$*" >&2; }
ok() { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }

if [[ "${EUID}" -ne 0 ]]; then
  err "rode como root (sudo)"
  exit 1
fi

# Confirmação (a menos que --yes)
if [[ "${1:-}" != "--yes" ]]; then
  read -r -p "Remover scrumban-agent desta VPS permanentemente? [y/N] " confirm
  if [[ ! "${confirm}" =~ ^[Yy]$ ]]; then
    echo "Abortado."
    exit 0
  fi
fi

# 1. Stop + disable systemd unit
log "parando ${SERVICE_NAME}.service..."
if systemctl is-active --quiet "${SERVICE_NAME}.service" 2>/dev/null; then
  systemctl stop "${SERVICE_NAME}.service" || true
fi
if systemctl is-enabled --quiet "${SERVICE_NAME}.service" 2>/dev/null; then
  systemctl disable "${SERVICE_NAME}.service" >/dev/null 2>&1 || true
fi

# 2. Remove unit file + drop-ins se houver
log "removendo unit..."
rm -f "${SERVICE_FILE}"
rm -rf "/etc/systemd/system/${SERVICE_NAME}.service.d"
systemctl daemon-reload

# 2b. Remove sudoers entry criada por install.sh §9c (plan-2026-05-13).
# Idempotente: rm -f não falha se já ausente.
SUDOERS_FILE="/etc/sudoers.d/${SERVICE_NAME}"
if [[ -e "${SUDOERS_FILE}" ]]; then
  log "removendo sudoers entry ${SUDOERS_FILE}..."
  rm -f "${SUDOERS_FILE}"
fi

# 3. Remove diretórios (inclui ${CONFIG_DIR}/ssh-keys e ${STATE_DIR}/.gitconfig).
log "removendo diretórios..."
rm -rf "${INSTALL_PREFIX}" "${CONFIG_DIR}" "${STATE_DIR}" "${LOG_DIR}"

# 4. Remove user
log "removendo user ${SERVICE_USER}..."
if id "${SERVICE_USER}" >/dev/null 2>&1; then
  # mata processos remanescentes antes do userdel
  pkill -u "${SERVICE_USER}" 2>/dev/null || true
  sleep 1
  userdel -r "${SERVICE_USER}" 2>/dev/null || userdel "${SERVICE_USER}" || true
fi

# 5. Verificação de resíduos
log "verificando resíduos..."
RESIDUE=0
for path in "${INSTALL_PREFIX}" "${CONFIG_DIR}" "${STATE_DIR}" "${LOG_DIR}" "${SERVICE_FILE}" "${SUDOERS_FILE}"; do
  if [[ -e "${path}" ]]; then
    warn "RESÍDUO: ${path} ainda existe"
    RESIDUE=1
  fi
done

if id "${SERVICE_USER}" >/dev/null 2>&1; then
  warn "RESÍDUO: user ${SERVICE_USER} ainda existe"
  RESIDUE=1
fi

if pgrep -u "${SERVICE_USER}" >/dev/null 2>&1; then
  warn "RESÍDUO: processos do user ainda rodando"
  RESIDUE=1
fi

if [[ "${RESIDUE}" -eq 0 ]]; then
  echo ""
  ok "scrumban-agent removido com sucesso"
  echo ""
  echo "Nota: /root/.claude/CLAUDE.md NÃO foi removido (preservado intencionalmente)."
  echo "Remova manualmente se desejar: rm /root/.claude/CLAUDE.md"
else
  echo ""
  warn "resíduos detectados — investigue manualmente"
  exit 1
fi
