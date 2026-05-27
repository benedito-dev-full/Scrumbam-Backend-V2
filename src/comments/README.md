# CommentsModule — Comentários Polimórficos

Módulo de comentários textuais sobre qualquer alvo suportado: `task`,
`project`, `folder`, `list` (e `doc` quando DocsModule chegar).

## Rotas

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/comments/:targetType/:targetId` | Criar comentário (201) |
| `GET` | `/comments/:targetType/:targetId` | Listar comentários (DESC, cursor) |

`targetType ∈ { task, project, folder, list }`. `ParseEnumPipe` rejeita
valores fora do enum com HTTP 400.

## Como funciona

Armazenamento polimórfico em `DEvento` com `idClasse=-507`:

| Campo DEvento | Conteúdo |
|---------------|----------|
| `idClasse` | `-507` (DClasse `TASK_COMMENT` — débito de naming, ver abaixo) |
| `idEntidade` | `DEntidade.chave` do autor |
| `identificadorExterno` | `targetId` (chave string do alvo) |
| `descricao` | texto do comentário |
| `metaDados` | `{ targetType, targetId, autorId }` (para filtros futuros) |
| `criadoEm` | timestamp automático |
| `excluido` | soft-delete (default `false`) |

Cursor pagination DESC pela `chave` BigInt. Zero N+1 — autor resolvido
via `include: { entidade }` em uma única query.

## Eventos emitidos

Após cada `create` bem-sucedido o service emite
`task.comment.created` (registrado em `event-types.ts` na Fase 1).
Payload:

```json
{
  "commentId": "12345",
  "targetType": "task",
  "targetId": "777",
  "autorId": "42",
  "metadata": { "source": "CommentsService", "timestamp": "..." }
}
```

O nome do tipo (`task.comment.created`) é compartilhado entre todos os
`targetType` v1 — consumidores diferenciam pelo `payload.targetType`.
Eventual segregação por tipo de evento (ex: `project.comment.created`)
fica deferida para quando houver caso de uso real.

## Débito de naming aceito

A DClasse `-507` carrega o `codigo='TASK_COMMENT'` apesar do uso
polimórfico (task / project / folder / list / doc). O nome é **histórico
da Fase 1**: o escopo original era específico de task; a polimorfização
ocorreu depois, com a Fase 1 já aprovada (8.5/10).

Renomear o seed exigiria:
1. Migration de seed (chave negativa, baixo risco — mas overhead).
2. Atualizar todos os pontos do código que referenciam `TASK_COMMENT`.
3. Re-revisar a Fase 1.

Decisão consciente do CEO (2026-05-27): **manter o nome** e documentar
o débito. O comportamento canônico (DClasse → semântica) não é afetado.

## Como adicionar um novo `targetType` (modelo para DOC)

1. **Enum** (`dto/comment-target-type.enum.ts`): descomentar/adicionar a
   entrada (ex: `DOC = 'doc'`).
2. **Resolver** (`comment-target.resolver.ts`): adicionar branch no
   `switch` de `resolveAndAuthorize` (ex: `case DOC` chama um novo
   `resolveDoc` que valida `DProject idClasse=-353` + membership).
3. **Service**: nenhuma mudança — persistência polimórfica é genérica.
4. **Controller**: nenhuma mudança — `ParseEnumPipe` aceita
   automaticamente o novo valor.

Não há mudança de schema. Não há novo endpoint. Não há nova DClasse de
DEvento — `-507` continua servindo.

## Autorização por `targetType`

| `targetType` | Como achar o alvo | Como autorizar |
|--------------|-------------------|----------------|
| `task` | `DTask.chave + excluido=false` | `ProjectsService.findAccessibleProjectIds` ⊇ `task.idProject` |
| `project` | `DProject.chave + idClasse ≠ FOLDER/LIST` | `DVincula in [-171,-172,-173]` para o requester |
| `folder` | `DProject.chave + idClasse=-351` | idem project |
| `list` | `DProject.chave + idClasse=-352` | idem project |

Tenant isolation (orgId × `DProject.idEstab`) aplicado no resolver com
mensagem genérica de 404 (anti-enumeration — mesmo padrão de ADR-V2-042).

## Pilar 1 (Engine) — não se aplica

`DEvento` é tabela ESTRUTURAL (audit trail). Engine/Operacao existe apenas
para tabelas TRANSACIONAIS (DPedido, DTitulo, DMovDispo, DMovDepos,
DSolicita, DRequisic). Persistência via `prisma.dEvento.create` direto é
o padrão correto e está alinhado com o uso atual de DEvento no V2.

## Tests

Testes de integração ficam para a Fase 4 do plano IA Tools Backend.
