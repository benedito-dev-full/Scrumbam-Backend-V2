# ADR-V2-043: Coluna `repoUrl` em DProject

**Status:** Proposto  
**Data:** 2026-05-15  
**Decisores:** Strategist Agent V2 + CEO  
**Tags:** #V2 #automation #f13 #exception #adr-v2-001

## Contexto

Projetos guardavam URL git em `DProject.dados.gitRepo`. Para o provisionamento
via agente VPS, essa URL passa a ser configuração estrutural do projeto: o
backend precisa lê-la e revalidá-la antes de enviar `PROVISION_PROJECT` ao
agente.

`dados.gitRepo` em JSON solto tem três problemas:

- não tem tipo estrutural além do DTO HTTP;
- complica filtros futuros por host/repositório;
- dificulta evolução para índices simples e constraints nativas.

## Decisão

Adicionar `repoUrl String? @db.VarChar(512)` em `DProject` como exceção
autorizada ao ADR-V2-001.

`repoUrl` é a fonte canônica. `dados.gitRepo` fica mantido por 1 release como
compatibilidade para clientes antigos, com escrita dual no backend.

## Alternativas

- Manter apenas `dados.gitRepo`: não muda schema, mas preserva o problema de
tipo e busca.
- Criar configuração via DTabela/DVincula: respeita estritamente o modelo
polimórfico, mas adiciona indireção e múltiplas queries para o caso comum de
um repo por projeto.
- Coluna `repoUrl`: simples, tipada e alinhada com a natureza estrutural do
dado.

## Critérios Para Exceções Futuras

1. O dado deve ser estrutural, não metadado opcional.
2. Deve haver justificativa de tipo, segurança ou performance.
3. O campo deve caber em tipo nativo simples.
4. Exige ADR e aprovação explícita.
5. Deve ser revisado como precedente excepcional, não como novo padrão livre.

## Consequências

Positivas:

- limite de 512 bytes aplicado pelo banco;
- leitura direta pelo fluxo de provisionamento;
- caminho simples para índice parcial futuro.

Negativas:

- cria precedente de coluna nova em tabela canônica;
- exige cuidado para não enfraquecer o ADR-V2-001.

## Implementação

- `prisma/schema.prisma`: adiciona `DProject.repoUrl`.
- Migration `20260515151000_add_repo_url_to_dproject`: adiciona coluna e faz
  backfill idempotente de `dados.gitRepo`.
- `ProjectsService`: escrita dual e fallback de leitura.
- DTOs de projeto: `repoUrl` validado por whitelist restritiva.
- `ProvisionService`: revalida `repoUrl` antes do dispatch ao agente.
