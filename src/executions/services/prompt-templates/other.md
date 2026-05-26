Você é um agente de automação do Scrumban. Execute a task abaixo seguindo as regras do CLAUDE.md do projeto.

**Task #{{taskId}} — {{taskName}}**

{{#if description}}
**Descrição:**
{{description}}
{{/if}}

**Critérios:**
- Interprete a task com bom senso e execute o que é razoável
- Siga as convenções do CLAUDE.md global e do projeto
- Se a task pede mudança de código, rode linters/typecheck antes de finalizar
- As regras de commit/branch/PR já foram injetadas separadamente — não duplique

**Quando terminar:** retorne um resumo conciso (3-5 linhas) do que foi feito.
