-- Migration: add_chcriacao_seq
-- F6 Engine Base: cria sequence separada para geração de chaves do Engine antes do INSERT.
-- O Engine (OperacaoPedido/OperacaoExecucaoClaude) chama nextval('chcriacao_seq') antes do INSERT em DPedido,
-- permitindo referenciar o ID em logs e eventos antes da persistência.
-- START WITH 1000000: separa range do Engine do BIGSERIAL default do DPedido (que inicia em 1).

CREATE SEQUENCE IF NOT EXISTS "chcriacao_seq"
  START WITH 1000000
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

-- Down (para rollback manual):
-- DROP SEQUENCE IF EXISTS "chcriacao_seq";
