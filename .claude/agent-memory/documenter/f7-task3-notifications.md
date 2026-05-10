# Documenter Memory - F7 Task #3 Notifications

**Data:** 2026-05-10
**Task:** F7 Task #3 - Notifications endpoints `/notifications/*`

## Registro

- ADR-V2-032 documenta a excecao pontual `DEvento.excluido Boolean @default(false)` para soft delete de notifications.
- A excecao foi autorizada explicitamente em 2026-05-10 e nao abre precedente para novas colunas sem ADR/autorizacao.
- Endpoints `/notifications/*` usam `DEvento -490`, `metaDados.read/readAt`, ownership por `idEntidade` e BigInt como string.
- Documentacao atualizada em `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `workspace/STATUS.md` e `src/eventos/README.md`.
- Commit nao foi criado nesta rodada por restricao explicita: worktree suja e sem pedido de commit.
