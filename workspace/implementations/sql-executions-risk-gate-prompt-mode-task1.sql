-- =====================================================================
-- ADR-V2-081 — Risk Gate avalia o prompt (modo PROMPT) — Task 1
-- Queries SOMENTE-LEITURA para o CEO rodar (NÃO executadas pelo Implementer).
--
-- Recomendado: abrir a sessão em modo read-only antes de colar:
--   BEGIN TRANSACTION READ ONLY;
--   ... queries ...
--   ROLLBACK;
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) PÓS-DEPLOY: conteúdo ativo do Risk Gate (DVFS chave 3) e sinal de versão
-- ---------------------------------------------------------------------
-- Esperado: 1 linha, idClasse=-300, versao=1, ativo=true, is_v2=true,
--           hash == md5 de dist/src/engine/dvfs/risk-gate-validator.js
--           (local, após o ciclo 3 pós-review: 60ef502ae52c8392f5c751cb3446d02f —
--            recalcular com `md5sum dist/src/engine/dvfs/risk-gate-validator.js` na imagem deployada).
-- Qualquer linha em -301/-302/-303 com chaveScript=3 = override concreto → investigar (R5).
SELECT "chave",
       "idClasse",
       "chaveScript",
       "versao",
       "ativo",
       md5("conteudo")                                   AS hash,
       position('validatorVersion: 2' in "conteudo") > 0 AS is_v2
FROM "DVFS"
WHERE "chaveScript" = 3
ORDER BY "idClasse", "versao";


-- ---------------------------------------------------------------------
-- 2) FASE 5 (medição de falso positivo): amostra dos PROMPTS reais já executados
-- ---------------------------------------------------------------------
-- Fonte mais fiel: dados.prompt persistido no DPedido (é exatamente o texto
-- que o validador v2 vai classificar). Só existe para execuções em modo PROMPT.
-- Ajustar LIMIT conforme o volume. NÃO publicar o resultado (contém texto de tasks).
SELECT p."chave"                         AS execution_id,
       p."idClasse"                      AS classe_atual,        -- v1: quase sempre -301
       p."criadoEm",
       p."dados" -> 'task' ->> 'id'      AS task_id,
       p."dados" ->> 'taskType'          AS task_type,
       p."dados" ->> 'prompt'            AS prompt
FROM "DPedido" p
WHERE p."idClasse" IN (-301, -302, -303)
  AND p."dados" ? 'prompt'
ORDER BY p."chave" DESC
LIMIT 200;


-- ---------------------------------------------------------------------
-- 3) FASE 5 (alternativa): nome + descrição das tasks que originaram execuções
-- ---------------------------------------------------------------------
-- Útil se poucas execuções tiverem dados.prompt (ou para medir tasks ainda não executadas,
-- trocando o JOIN por um filtro em "DTask").
SELECT DISTINCT ON (t."chave")
       t."chave"      AS task_id,
       t."nome",
       t."descricao",
       p."criadoEm"   AS executada_em
FROM "DPedido" p
JOIN "DTask" t
  ON t."chave" = (p."dados" -> 'task' ->> 'id')::bigint
WHERE p."idClasse" IN (-301, -302, -303)
  AND p."dados" -> 'task' ->> 'id' ~ '^[0-9]+$'
  AND t."excluido" = false
ORDER BY t."chave" DESC, p."criadoEm" DESC
LIMIT 200;


-- ---------------------------------------------------------------------
-- Como classificar offline (sem tocar o banco de novo):
--   1. Exportar o resultado da query 2 (ou 3) para CSV/JSON local.
--   2. Rodar o validador real (src/engine/dvfs/risk-gate-validator.js) via node
--      sobre cada linha, com op = { dados: { command: { text: 'claude -p task-built-prompt-placeholder' },
--                                            prompt: <prompt ou nome+"\n"+descricao> } }.
--   3. Reportar % LOW / MEDIUM / HIGH e os padrões MEDIUM mais frequentes.
--   Critério do plano: se MEDIUM+HIGH > ~30%, rever padrões MEDIUM ruidosos
--   (refactor, config…update, rebuild, package.json) apenas para source='prompt'.
--   Registrar o resultado no ADR-V2-081 (seção "Medição de falso positivo").
-- ---------------------------------------------------------------------
