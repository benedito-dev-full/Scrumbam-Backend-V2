#!/bin/bash
# block-destructive-commands.sh (V2)
# PreToolUse hook that blocks destructive commands in Bash
#
# Exit 2 = block command (stderr returns to Claude as error)
# Exit 0 = allow command

set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  exit 0
fi

# 1. Prisma destructive
if echo "$COMMAND" | grep -iE 'accept-data-loss|--force-reset' > /dev/null; then
  echo "BLOCKED (V2): --accept-data-loss / --force-reset detectado." >&2
  echo "Use ALTER TABLE RENAME ou ADR-V2-XXX justificando." >&2
  exit 2
fi

if echo "$COMMAND" | grep -iE 'prisma\s+migrate\s+reset' > /dev/null; then
  echo "BLOCKED (V2): prisma migrate reset apaga TODA a base!" >&2
  echo "Faça pg_dump primeiro." >&2
  exit 2
fi

if echo "$COMMAND" | grep -iE 'prisma\s+db\s+push' > /dev/null; then
  echo "BLOCKED (V2): prisma db push pode causar perda de dados!" >&2
  echo "Use prisma migrate dev (protocolo de migrations canônico)." >&2
  exit 2
fi

# 2. SQL destructive
if echo "$COMMAND" | grep -iE '\bDROP\s+(TABLE|DATABASE|SCHEMA)\b' > /dev/null; then
  echo "BLOCKED (V2): DROP TABLE/DATABASE/SCHEMA detectado!" >&2
  exit 2
fi

if echo "$COMMAND" | grep -iE '\bTRUNCATE\b' > /dev/null; then
  echo "BLOCKED (V2): TRUNCATE detectado!" >&2
  exit 2
fi

# 3. Filesystem destructive
if echo "$COMMAND" | grep -iE 'rm\s+(-rf|-fr)\s+(/|src/|\.claude/|prisma/|docs/|workspace/)' > /dev/null; then
  echo "BLOCKED (V2): rm -rf em diretório crítico detectado!" >&2
  echo "Diretórios protegidos: /, src/, .claude/, prisma/, docs/, workspace/" >&2
  exit 2
fi

# 4. Git destrutivo (force push em main/master)
if echo "$COMMAND" | grep -iE 'git\s+push\s+.*\s+(main|master)\b.*--force|git\s+push\s+--force\s+.*\s+(main|master)' > /dev/null; then
  echo "BLOCKED (V2): force push em main/master proibido sem aprovação CEO." >&2
  exit 2
fi

# 5. Hooks bypass
if echo "$COMMAND" | grep -iE 'git\s+commit\s+.*--no-verify' > /dev/null; then
  echo "BLOCKED (V2): --no-verify (skip hooks) proibido." >&2
  echo "Hooks são fronteira mecânica de qualidade — não bypassar." >&2
  exit 2
fi

exit 0
