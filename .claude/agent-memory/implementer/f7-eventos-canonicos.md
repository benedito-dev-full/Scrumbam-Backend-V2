---
name: F7 Eventos Canônicos — patterns
description: Padrões e gotchas descobertos durante F7 Task#1 Bloco Q (AuditService delete + Engine typed)
type: project
---

# F7 Eventos Canônicos — Notas Operacionais

**Data:** 2026-05-09
**Bloco:** F7 Task#1 — Bloco Q (sub-sessão final)

## Padrões V2 que se consolidaram nessa fase

### CommonModule @Global() é o ancorador
- `src/common/common.module.ts` exporta `PrismaService`, `CorrelationIdService`, `TimezoneService`.
- Marcado `@Global()` — providers ficam visíveis em qualquer módulo (Email, Organizations, Projects, Tasks, Eventos, Executions, etc.) sem importar.
- Resultado: ~5 declarações duplicadas de `PrismaService` removidas dos modules.
- IMPORTANTE: AsyncLocalStorage (em `CorrelationIdService`) é compartilhado pela `const storage` no escopo do módulo TS — mesmo se duas instâncias do service existirem (não devem), o storage é o mesmo.

### EventProducer pattern V2 (substitui AuditService)
**Padrão de uso em service:**
```typescript
constructor(
  private readonly prisma: PrismaService,
  private readonly eventProducer: EventProducerService,
  private readonly correlationIdService: CorrelationIdService,
) {}

async fooCriar(dto): Promise<Foo> {
  const foo = await this.prisma.$transaction(/*...*/);

  // Audit APÓS commit
  await this.eventProducer.addInternalEvent(
    'foo.created',
    { fooId: foo.chave.toString(), nome: dto.nome, userId: userId.toString() },
    this.correlationIdService.getOrGenerate(),
    { source: MyService.name },
  );
  return foo;
}
```

### Engine isolation via type-only import
- F6 Engine recebe `eventProducer: IEventProducer` no constructor (não `EventProducerService`).
- `import type { IEventProducer } from '../../../eventos/interfaces/event-producer.interface';` — TypeScript-only, ZERO runtime dependency entre `src/engine/` e `src/eventos/`.
- ExecutionsService injeta `EventProducerService` real e passa para o `OperacaoExecucaoClaude` — funciona via duck typing.

## Gotchas

### 1. CommonModule pode não existir mesmo se importado
Quando peguei a sessão, `eventos.module.ts` importava `CommonModule` mas o arquivo não existia. Build quebrava com TS2307. Solução: criar o módulo do zero.

### 2. `imports: [CommonModule]` é REDUNDANTE quando CommonModule é Global
Após criar `CommonModule @Global()`, removi `imports: [CommonModule]` do EventosModule. Funciona igual e reduz boilerplate.

### 3. `private readonly logger` em controller compilation
Não foi problema nesta sessão, mas reforça padrão: se o `logger` é usado, declarar; se não usado, remover (TS6138 strict).

### 4. Spec com múltiplos módulos de teste
`tasks.service.spec.ts` tem um teste secundário ('identifier atômico (10 chamadas sequenciais)') que cria seu próprio `Test.createTestingModule`. Ao migrar mocks de DI, **TEM que atualizar AMBOS os módulos** — fácil esquecer.

### 5. `executions.service.unit.spec.ts` instancia direto via `new`
Não usa NestJS Testing module — instancia direto: `new ExecutionsService(prisma, ent, claude, eventProducer)`. Adicionar parâmetro novo no constructor força atualizar `buildService()` helper. Sintoma: TS2554 "Expected 4 arguments, got 3".

### 6. Tipo emitido pelo Engine deve estar no catálogo
`OperacaoExecucaoClaude.ts` linha 399 emite `'execution.succeeded'` (em sucesso) ou `'execution.failed'`. Sem `EXECUTION_SUCCEEDED` em `EVENT_TYPES`, qualquer execução bem-sucedida quebraria com `BadRequestException("type não está em ALL_EVENT_TYPES")`. Sempre auditar `Engine` por `addInternalEvent` antes de fechar a fase.

### 7. Logger debug em service.spec.ts pode poluir output
EmailService.spec emite `[EmailService] Falha ao enviar email...` durante o teste de erro — não é falha, é o teste exercitando o caminho de exceção. Reviewer pode achar suspeito visualmente.

## Anti-padrões CONFIRMADOS

- ❌ Importar `EventProducerService` no Engine (`src/engine/`) — usar `IEventProducer` typed.
- ❌ Façade `AuditService` chamando `EventProducer` por baixo — Decision CEO #4 = delete, não façade.
- ❌ `eventProducer.emit('foo.created', ...)` antes de `prisma.$transaction` — sempre APÓS commit.
- ❌ `prisma.dEvento.create()` direto em service que NÃO seja `audit-log.consumer.ts` — em `auth.service.ts` ainda existe (débito identificado).

## Auth Service — débito não resolvido

`src/auth/auth.service.ts` linhas 235, 353, 570 emitem `prisma.dEvento.create` direto (descricao 'auth.login' etc). Não estavam no escopo do briefing F7 Task#1 Bloco Q. Reviewer/CEO decide se entra na próxima sub-task ou cleanup.
