# Regras Globais (valem para TODOS os projetos)

## Git — commit e push obrigatórios após qualquer mudança

Após concluir qualquer tarefa que altere arquivos:

1. Crie uma branch com o formato `scrumban/auto-<slug-curto-da-tarefa>`
   - Exemplo: `scrumban/auto-remove-botao-automacao`
2. Faça commit de todas as alterações com mensagem descritiva em português
   - Formato: `<tipo>: <descrição curta>`
   - Exemplo: `feat: remove botão de automação da sidebar`
3. Faça push da branch para o repositório remoto (`origin`)
4. **NUNCA** faça push direto em `main` ou `master`

Se não houver nenhuma alteração real nos arquivos, não crie branch nem commit.

---

# Projetos nesta VPS

> Este arquivo é o **mapa de projetos** que o agente Scrumban e o Claude Code
> usam pra identificar onde cada projeto está nesta VPS. Cada vez que você
> clonar um projeto novo aqui, **adicione uma seção H2** abaixo usando o
> mesmo `projectSlug` que aparece no Scrumban (campo `dados.slug` do
> `DProject`, derivado automaticamente do nome do projeto).
>
> O agente lê este arquivo pra resolver `projectSlug` → caminho absoluto na
> VPS. Slug errado ou caminho fora de `allowedProjectRoots` (config do agente
> em `/etc/scrumban-agent/config.json`) faz a execução falhar com
> `UNKNOWN_PROJECT_SLUG` ou `WORKSPACE_OUTSIDE_ALLOWED_ROOT` — em ambos os
> casos seguros, não há fallback silencioso.
>
> **Formato esperado de cada entrada (NÃO ALTERE):**
>
> ```
> ## <slug>
> - Caminho: <path-absoluto>
> - O que é: <descrição curta>
> - Quando mexer aqui: <gatilho de roteamento para o agente>
> ```
>
> O label `- Caminho:` é parseado pelo `identity-resolver` do agente
> (também aceita `- Path:`). Outros campos são informativos.

---

## scrumban-backend-v2

- Caminho: /home/dev/projetos/Scrumban-Backend-V2
- O que é: Backend da plataforma Scrumban (refundação canônica V2)
- Quando mexer aqui: pedidos sobre API, endpoints, banco, automação,
  regras de negócio, integração V3 Intentions, F13 (Claude Code remoto)

## scrumban-frontend

- Caminho: /home/dev/projetos/Scrumbam-FrontEnd
- O que é: Interface web do Scrumban (React + TypeScript)
- Quando mexer aqui: pedidos sobre cor, layout, botão, tela, modal,
  rota, formulário, qualquer coisa visual

<!--
  Adicione mais entradas conforme novos projetos.
  Exemplo:

  ## meu-projeto-novo
  - Caminho: /home/dev/projetos/meu-projeto-novo
  - O que é: descrição do projeto
  - Quando mexer aqui: gatilhos para o agente decidir rotear pra cá

  REGRAS:
  1. O caminho DEVE estar sob uma das raízes em `allowedProjectRoots`
     (config do agente). Default da install: /home/dev/projetos
  2. Slug é case-sensitive e único por VPS.
  3. NÃO use paths apontando para /etc, /var, /root, /home/scrumban-agent,
     ou diretórios do sistema — o agente bloqueia.
  4. NÃO commite este arquivo em repos públicos: ele revela layout
     interno da sua VPS.
-->
