---
name: padroes-violados-recorrentes
description: Antipadrões que se repetiram em mais de um módulo/fase — checar proativamente em código novo do mesmo tipo.
metadata:
  type: feedback
---

# Padrões Violados Recorrentes (Reviewer)

**Por que:** estes antipadrões apareceram mais de uma vez em módulos diferentes — vale checar proativamente, não só reativamente.
**Como aplicar:** ao revisar DTOs de ID, paginação, ou código de bootstrap/seed, checar explicitamente contra esta lista.

| Padrão | Frequência | Como abordar |
|--------|------------|--------------|
| Acoplamento horizontal entre módulos via DTO compartilhado | F2 (PaginationMetaDto) | Sempre mover DTOs compartilhados para `src/common/dto/` |
| Acesso a campo privado de Service via bracket notation em Controller | F3 (authService['prisma']) | Controller NUNCA acessa campo privado de Service; expor método público |
| N+1 em write path (loop com await em UPDATE/DELETE bulk) | F3 (revokeApiKeys) | Usar updateMany/deleteMany com where clause |
| parseInt(param) para query params numéricos (limit, page) | F5 (4 controllers) | Usar Number(param) ou DTO com @Type(() => Number) |
| for...of com await individual em seed bootstrap | F5 (seed-bootstrap) | Preferir createMany para batch INSERTs |
| Service sem AuditService quando deveria auditar | F5 (TeamsService) | Todo service que cria/deleta entidades deve injetar AuditService |
| ScheduleModule.forRoot() duplicado (app.module + feature module) | F6 (ExecutionsModule) | Feature modules com @Cron devem usar ScheduleModule.forFeature(), nunca forRoot() |
| Testes de integração (banco real) ausentes mas plano exigia | F6 (executions.integration.spec.ts) | Plano com I1-I4 explícitos = integração obrigatória; unit tests não substituem para concorrência real |
| (op as any).chcriacao acesso a campo protegido do Engine | F6 (ExecutionsService) | Engine deve expor getter público getChave(): bigint para evitar any cast |
| `@IsString()` em DTO onde plano especifica `@IsNumberString()` | D1 (bookmarks) | Todo campo de ID numérico como string DEVE ter @IsNumberString(). Padrão aplicado em todos os outros DTOs do projeto |
| `hasMore` calculado sobre array pós-filtro em vez de pré-filtro | D1 (bookmarks) | Quando filtro em memória JS é aplicado após `findMany`, `hasMore` deve refletir dados do banco, não do slice filtrado. Mover filtro para WHERE Prisma ou ajustar lógica |
