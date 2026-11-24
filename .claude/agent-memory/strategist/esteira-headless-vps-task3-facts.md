# Task 3 — Esteira headless na VPS (ADR-V2-083 proposto)

Fatos verificados empiricamente (claude 2.1.330, 2026-11-23):
- `claude -p` carrega CLAUDE.md do projeto, rules ancestrais, ~/.claude/CLAUDE.md e .claude/agents MESMO com --system-prompt (comentário do handler era falso).
- Hooks de .claude/settings.json rodam em -p + --dangerously-skip-permissions (SessionStart/Stop testados).
- Slash command do repo funciona em -p ("/cmd args"). `--json-schema` gera `structured_output` no JSON final.
- JSON final traz `subagent_stats.by_type` → evidência independente de quais subagents rodaram.
- `--bare` pula hooks E CLAUDE.md → nunca usar. execFile deixa stdin aberto (3s de espera).
- Workspace não confiado ignora permissions/allow do settings.local.json.

Decisões do plano: abordagem B+ (comando /scrumban-executar no repo + envelope + contrato JSON + verificação git/gh/subagents pelo agente); backend antes do agente (forbidNonWhitelisted); slug do dispatch = DVincula.metaDados.projectSlug; L6 (kill de grupo) obrigatório; ExecutionResponseDto já expõe git/pullRequest (nunca preenchidos).
Perguntas CEO: P1 repo sem comando, P2 limites 4h/6h, P3 PR draft sem aprovação, P4 busy por tempo.
