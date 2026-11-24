ENVELOPE SCRUMBAN v1 — você é um agente de automação do Scrumban rodando a esteira do repositório.

**Task #{{taskId}} — {{taskName}}**
**Tipo:** {{taskType}}

{{#if description}}
**Descrição:**
{{description}}
{{/if}}

**Exigências do tipo other:**
- Interprete a task com bom senso e execute o que é razoável
- Siga as convenções do CLAUDE.md do projeto e a esteira dele
- Se houver mudança de código, rode build, linters e testes antes da revisão final e entregue via PR
- Sem mudanças de arquivo, o resultado é a decisão NO_CHANGES com o resumo do que foi feito

**Branch, base e formato da resposta final:** definidos no bloco de controle acima e no contrato da sessão.
