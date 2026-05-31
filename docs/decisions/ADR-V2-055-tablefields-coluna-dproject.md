# ADR-V2-055: `tableFields` como coluna em DProject

**Status:** Aceito  
**Data:** 2026-05-31  
**Decisores:** CEO + Implementer Codex  
**Tags:** #V2 #table-view #dproject #adr-v2-001 #adr-v2-043

## Contexto

A Table View do frontend V2 precisa de colunas customizaveis por Lista, no
estilo Monday/ClickUp. O contrato de produto suporta 8 tipos:

- `text`
- `number`
- `date`
- `person`
- `status`
- `checkbox`
- `dropdown`
- `link`

Uma Lista e um `DProject` com `idClasse=-352`. O schema das colunas deve ser
compartilhado por todas as tasks dessa Lista, enquanto cada celula tem valor
por task.

O projeto ja possui dois precedentes relevantes:

- ADR-V2-001: zero tabela nova. A regra bloqueia novas tabelas, nao colunas
  aditivas em tabelas canonicas existentes.
- ADR-V2-043: `repoUrl` virou coluna dedicada em `DProject` por ser dado
  estrutural de primeira classe, em vez de ficar escondido em `dados`.
- ADR-V2-034: status/priority globais usam `DTabela` escopada por projeto; para
  colunas customizaveis da Lista, as options ficam inline no schema da coluna.

## Decisao

Persistir o schema de colunas customizaveis na coluna dedicada
`DProject.tableFields Json?`.

O formato canonico e:

```json
{
  "version": 1,
  "columns": [
    {
      "key": "f_a1b2",
      "type": "dropdown",
      "label": "Cliente",
      "order": 0,
      "required": false,
      "config": {
        "options": [{ "id": "o_1", "label": "Votorantim" }]
      }
    }
  ]
}
```

Os valores das celulas ficam em `DTask.dados.fields`, chaveados por
`ColumnDef.key`:

```json
{
  "fields": {
    "f_a1b2": "o_1",
    "f_c3d4": 42
  }
}
```

Escrita de schema reutiliza `PATCH /projects/:id`. Escrita de valores reutiliza
`PUT /tasks/:id`. Nenhum endpoint novo foi criado.

## Alternativas Consideradas

### Opcao A: `DProject.dados.tableFields`

Rejeitada.

Vantagem: evitaria migration.  
Problemas: cria JSON-dentro-de-JSON, mistura schema estrutural com dados
operacionais (`slug`, `prefix`, `automationEnabled`) e aumenta risco de
lost-update cruzado.

### Opcao B: coluna dedicada `DProject.tableFields`

Escolhida.

Repete o precedente de `DClasse.tableFields` e de `DProject.repoUrl`: dado
estrutural de primeira classe deve ficar em coluna propria, nullable e aditiva.

### Options via `DTabela`

Rejeitada para o MVP de colunas customizaveis.

ADR-V2-034 continua valido para status/priority globais do projeto. Para
`status` e `dropdown` customizados por Lista, as options pertencem ao proprio
schema da coluna e ficam em `config.options[]`.

## Consequencias

Positivas:

- schema das colunas fica isolado de `DProject.dados`;
- leitura de projeto expoe `tableFields` diretamente;
- valores de task podem ser mesclados por chave em `DTask.dados.fields`;
- zero tabela nova, em conformidade com ADR-V2-001;
- caminho de integracao do frontend fica simples: schema no projeto, valores
  nas tasks.

Negativas:

- adiciona uma coluna JSONB a `DProject`;
- valores orfaos podem permanecer em `DTask.dados.fields` quando uma coluna e
  removida do schema;
- concorrencia otimista baseada em `version` ainda nao e enforced.

## Regras de Implementacao

1. `DProject.tableFields` e a unica fonte de verdade do schema por Lista.
2. `DProject.dados.tableFields` nao deve ser usado.
3. `DClasse.tableFields` permanece escopo de classe/template, nao de Lista.
4. `DTask.dados.fields` deve ser atualizado por merge de chave, nunca por
   substituicao do objeto inteiro.
5. Chaves recebidas em `dados.fields` que nao existem no schema da Lista devem
   ser ignoradas e nao persistidas.
6. Valor `null` limpa a celula, exceto quando a coluna e `required`.
7. Valor invalido por tipo deve retornar `BadRequestException`.
8. Validacao de valores deve buscar `DProject.tableFields` uma unica vez por
   update de task, sem N+1.

## Implementacao

- `prisma/schema.prisma`: `DProject.tableFields Json?`.
- `src/tasks/table-fields/column-def.dto.ts`: DTOs do contrato.
- `src/tasks/table-fields/table-fields.validator.ts`: validacao do schema.
- `src/tasks/table-fields/field-value.validator.ts`: validacao dos valores.
- `src/projects/projects.service.ts`: `PATCH /projects/:id` grava direto na
  coluna `tableFields` e responses expoem o campo.
- `src/tasks/tasks.service.ts`: `PUT /tasks/:id` valida valores por tipo e
  mescla `DTask.dados.fields` por chave.

## Status de Testes

- `field-value.validator.spec.ts`: cobre os 8 tipos com casos validos e
  invalidos, alem de `null`, required e chaves desconhecidas.
- `tasks.service.custom-fields.spec.ts`: cobre merge seguro, chave desconhecida,
  limpeza com `null` e rejeicao antes de persistir valor invalido.

## Referencias

- ADR-V2-001: zero tabela nova.
- ADR-V2-043: `repoUrl` como coluna dedicada em `DProject`.
- ADR-V2-034: status/priority via `DTabela` por projeto, mantido como
  precedente para lookups globais.
