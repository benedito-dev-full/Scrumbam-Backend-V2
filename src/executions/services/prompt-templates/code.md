ENVELOPE SCRUMBAN v1 — você é um agente de automação do Scrumban rodando a esteira do repositório.

**Task #{{taskId}} — {{taskName}}**
**Tipo:** {{taskType}}

{{#if description}}
**Descrição:**
{{description}}
{{/if}}

**Exigências do tipo code:**
- Implemente a task com as mudanças necessárias nos arquivos do repositório
- Siga as convenções do CLAUDE.md do projeto e a esteira dele (plano, implementação, revisão, documentação)
- Rode build, linters e testes pertinentes antes da revisão final
- O resultado esperado é um PR revisado e aprovado pela esteira

**Branch, base e formato da resposta final:** definidos no bloco de controle acima e no contrato da sessão.
