---
name: padroes-engine-dvfs-build-reference
description: Referência permanente — 21 padrões, anti-padrões V2, regra Engine (OperacaoExecucaoClaude), chaves DVFS, build dinâmico, gotchas V2. Muito já vem do skill devari-backend-patterns auto-injetado.
metadata:
  type: project
---

# Padrões / Engine / DVFS / Build — Referência Permanente

Grande parte já é auto-injetada pelos skills `devari-backend-patterns` e
`devari-3-pilares`. Aqui fica o resumo V2-específico movido de `MEMORY.md`.

## 21 padrões obrigatórios (skill devari-backend-patterns)
1 PrismaService (não DatabaseService) · 2 BigInt IDs · 3 $transaction multi-tabela · 4 TimezoneService · 5 EntidadeService.getEntidadeIdFromUserGroup · 6 N+1 ZERO (include/select/batch) · 7 Eventos APÓS persistência · 8 Decimal(19,4) (raro em V2) · 9 DTOs class-validator+Swagger · 10 Guards em endpoints privados · 11 Logger NestJS (não console.log) · 12 HttpException apropriada · 13 Controller orquestra · 14 Service isola lógica · 15 EventProducerService + naming · 16 Cursor pagination + select · 17 Testes unit+integration · 18 Swagger completo · 19 Imports organizados · 20 Constantes de IDs só no seed · 21 Checklist final.

## Anti-padrões V2
**8 clássicos:** DatabaseService deprecated → PrismaService; parseInt → BigInt; setHours/UTC → TimezoneService; N+1 loop → include/batch; emit antes de persistir → depois; `prisma.dPedido.create()` direto → OperacaoExecucaoClaude; User/Sprint/StatusController → reusar /entidades /tabelas; seed faltando → sistema não inicia.
**Extras V2:** 9 modelo novo no schema.prisma → hook `enforce-canonical-tables.sh` bloqueia; 10 coluna nova em canônica sem ADR → `dados`/`metaDados` Json; 11 sequestro de DClasse canônica (-40,-45,-47,-49,-50,-1..-110) → renumerar -150..-529; 12 Engine em cadastro estrutural (DEntidade/DTask/DProject/DTabela) → Service+Prisma; 13 chave POSITIVA no seed → sempre negativa; 14 `role` enum em DUserGroup → RBAC via DVincula+idClasse (-161/-162/-163, -171/-172/-173); 15 DProjectMember/DNotification/DWebhook/DAgent/DExecution → eliminadas, usar canônicas.

## REGRA ABSOLUTA: Engine APENAS em DPedido idClasse=-300/-301/-302/-303
```typescript
// CORRETO — F6/F13
import OperacaoExecucaoClaude from 'src/engine/lib/operacao/OperacaoExecucaoClaude';
const op = new OperacaoExecucaoClaude({ usuario: userId.toString(), classe: '-301', bd: this.prisma }); // -301/-302/-303 conforme Risk Gate
await op.nova();
op.pedidoCab.setDados({ command, riskLevel, category });
await op.calcula();
await op.aprova({ aprovador: userId.toString() });
await op.grava();
```
Cadastros estruturais (DEntidade/DTask/DProject) → Service + Prisma + `$transaction` (NUNCA Engine):
```typescript
return await this.prisma.$transaction(async (tx) => {
  const org = await tx.dEntidade.create({ data: { idClasse: -152n, nome: dto.nome } });
  await tx.dVincula.create({ data: { idClasse: -161n, idLocEscritu: org.chave, idEntidade: userId } }); // ADMIN
  return org;
});
```

## DVFS — chaves de script (OperacaoExecucaoClaude, F6)
| Chave | Momento | Propósito V2 |
|---|---|---|
| 3 | Pré-cálculo | Validar comando, classificar risco (Risk Gate) |
| 4 | Cálculo | Custos estimados, prazo |
| 5 | Pós-cálculo | Ajustes finais antes de aprova |
| 6 | Pré-gravação | Validar aprovador (HIGH = aprovação manual) |
| 7 | Pós-gravação | Side-effects (DEvento -496 EXECUTION_LOG, fila BullMQ) |

**Bug latente:** risco `s.id` vs `s.chave` em `_carregaScriptsCalc`/`_carregaScriptsGrav`. F6 DoD exige 2 testes regressivos adversariais bloqueantes (ADR-V2-007, §5 plano-mestre).

## Build
```bash
if [ -f Makefile ] && grep -q "^build:" Makefile; then make build; else npm run build; fi
npx tsc --noEmit          # 0 errors
npx eslint "src/**/*.ts" --max-warnings 0   # aspas p/ glob no Windows
```
Hooks: `validate-implementation.sh` (Stop 180s), `validate-implementer-build.sh` (SubagentStop).

## Convenção de query V2 (ADR-V2-015/016)
`?idClasse=-150` canônico (BigInt direto); `?classe=NOME` deprecated (LRU 5min + warn + Sunset 2026-06-05). Ambos ou nenhum → 400. EntidadeController aceita ambos (USER -150, ORGANIZATION -152).

## Gotchas V2 conhecidos
- **jsonb_set identifier DEV-N**: raw UPDATE + RETURNING em transação; 10-thread test obrigatório.
- **F13 command injection**: TDD 58 testes adversariais ANTES do código (whitelist+AST+regex).
- **F13 SSH reverso**: TOFU + HMAC; rotação de chaves.
- **F1 idPai do seed**: validator automatizado (todos idPai existem) + peer-review.
- **F15 cutover**: 3 ensaios cronometrados em staging; abort às 04:00.
- **TS2564 DTOs (strictPropertyInitialization)**: `campo!: tipo` em campos obrigatórios sem construtor.
- **Prisma Json**: cast `as Prisma.InputJsonValue` (Record<string,unknown> não compatível direto).
- **Windows**: `make` indisponível → `npm run build`. `npm install` antes do 1º build.

## Endpoints V2 (128 — escopo Scrumban-hoje)
F2 /entidades /tabelas /classes · F3 /auth /users · F5 /projects /tasks /sprints(wrapper) /workflow-statuses(wrapper) · F6 /executions · F8-F9 /flow-metrics /forecast /reports /dashboards · F10 /channels /channels/telegram/webhook · F11 /mcp/* · F12 /webhooks · F13 /agents. Contrato: `Scrumbam-Backend/docs/API-CONTRACT.md`.
