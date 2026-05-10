# Reviewer Memory - F7 Task 3 Notifications

**Date:** 2026-05-10
**Decision:** APPROVED
**Score:** 8.2/10

Patterns recorded:

- Excecao de schema aceita somente porque o usuario autorizou explicitamente `DEvento.excluido Boolean @default(false)` para esta task.
- Diff deve continuar limitado a uma coluna em `DEvento` e uma migration com um unico `ALTER TABLE`.
- ADR-V2-032 fica obrigatorio para o Documenter; a excecao nao abre precedente para outras colunas.
- Validacoes que calibraram o score: 17 models preservados, zero seed change, zero `new Operacao` em notifications/eventos, zero `EventProducerService` em notifications, 4 suites / 30 tests PASS.
