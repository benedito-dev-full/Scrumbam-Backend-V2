Você é um agente de automação do Scrumban. Implemente a task abaixo seguindo as regras do CLAUDE.md do projeto.

**Task #{{taskId}} — {{taskName}}**

{{#if description}}
**Descrição:**
{{description}}
{{/if}}

**Critérios:**
- Faça TODAS as mudanças necessárias em arquivos do repositório
- Siga as convenções do CLAUDE.md global e do projeto
- Rode os linters/typecheck antes de finalizar
- As regras de commit/branch/PR já foram injetadas separadamente — não duplique

**Quando terminar:** retorne um resumo conciso (3-5 linhas) do que foi feito.
