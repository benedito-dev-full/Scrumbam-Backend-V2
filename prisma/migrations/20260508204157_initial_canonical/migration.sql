-- CreateTable
CREATE TABLE "DClasse" (
    "chave" BIGINT NOT NULL,
    "codigo" VARCHAR(64),
    "nome" VARCHAR(255) NOT NULL,
    "idPai" BIGINT,
    "agrupamento" BOOLEAN NOT NULL DEFAULT false,
    "inativo" BOOLEAN NOT NULL DEFAULT false,
    "excluido" BOOLEAN NOT NULL DEFAULT false,
    "excluivel" BOOLEAN NOT NULL DEFAULT true,
    "editavel" BOOLEAN NOT NULL DEFAULT true,
    "tableFields" JSONB,
    "baseFields" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DClasse_pkey" PRIMARY KEY ("chave")
);

-- CreateTable
CREATE TABLE "DEntidade" (
    "chave" BIGSERIAL NOT NULL,
    "idClasse" BIGINT NOT NULL,
    "codigo" VARCHAR(64),
    "nome" VARCHAR(255) NOT NULL,
    "nomeFantasia" VARCHAR(255),
    "cpfCnpj" VARCHAR(20),
    "email" VARCHAR(255),
    "telefone" VARCHAR(32),
    "celular" VARCHAR(32),
    "endereco" VARCHAR(255),
    "bairro" VARCHAR(128),
    "cep" VARCHAR(16),
    "idUF" BIGINT,
    "idCidade" BIGINT,
    "idBanco" BIGINT,
    "agencia" VARCHAR(16),
    "conta" VARCHAR(32),
    "codigoFebraban" VARCHAR(8),
    "limiteCredito" DECIMAL(19,4),
    "idEstab" BIGINT,
    "idLocEscritu" BIGINT,
    "dUserGroupId" BIGINT,
    "dados" JSONB,
    "metaDados" JSONB,
    "inativo" BOOLEAN NOT NULL DEFAULT false,
    "excluido" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DEntidade_pkey" PRIMARY KEY ("chave")
);

-- CreateTable
CREATE TABLE "DTabela" (
    "chave" BIGSERIAL NOT NULL,
    "idClasse" BIGINT NOT NULL,
    "codigo" VARCHAR(64),
    "nome" VARCHAR(255) NOT NULL,
    "descricao" TEXT,
    "percentual" DECIMAL(19,4),
    "recurso" VARCHAR(128),
    "uf" VARCHAR(2),
    "dEntidadeId" BIGINT,
    "idLocEscrituracao" BIGINT,
    "dados" JSONB,
    "metaDados" JSONB,
    "inativo" BOOLEAN NOT NULL DEFAULT false,
    "excluido" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DTabela_pkey" PRIMARY KEY ("chave")
);

-- CreateTable
CREATE TABLE "DVincula" (
    "chave" BIGSERIAL NOT NULL,
    "idClasse" BIGINT NOT NULL,
    "idLocEscritu" BIGINT NOT NULL,
    "idEntidade" BIGINT,
    "idTabela" BIGINT,
    "percentual" DECIMAL(19,4),
    "tipo" VARCHAR(64),
    "nome" VARCHAR(255),
    "referencia" VARCHAR(512),
    "descricao" TEXT,
    "metaDados" JSONB,
    "excluido" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DVincula_pkey" PRIMARY KEY ("chave")
);

-- CreateTable
CREATE TABLE "DEvento" (
    "chave" BIGSERIAL NOT NULL,
    "idClasse" BIGINT NOT NULL,
    "idEntidade" BIGINT,
    "identificadorExterno" VARCHAR(255),
    "descricao" TEXT,
    "metaDados" JSONB,
    "criadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DEvento_pkey" PRIMARY KEY ("chave")
);

-- CreateTable
CREATE TABLE "DRecurso" (
    "chave" BIGSERIAL NOT NULL,
    "idClasse" BIGINT NOT NULL,
    "codigo" VARCHAR(64),
    "nome" VARCHAR(255) NOT NULL,
    "descricao" TEXT,
    "preco" DECIMAL(19,4),
    "custo" DECIMAL(19,4),
    "unidade" VARCHAR(16),
    "metaDados" JSONB,
    "inativo" BOOLEAN NOT NULL DEFAULT false,
    "excluido" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DRecurso_pkey" PRIMARY KEY ("chave")
);

-- CreateTable
CREATE TABLE "DUserGroup" (
    "chave" BIGSERIAL NOT NULL,
    "idClasse" BIGINT NOT NULL,
    "usuario" VARCHAR(128) NOT NULL,
    "senha" VARCHAR(255) NOT NULL,
    "nome" VARCHAR(255),
    "email" VARCHAR(255),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "excluido" BOOLEAN NOT NULL DEFAULT false,
    "ultimoLogin" TIMESTAMPTZ(6),
    "dados" JSONB,
    "criadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DUserGroup_pkey" PRIMARY KEY ("chave")
);

-- CreateTable
CREATE TABLE "DPermissao" (
    "chave" BIGSERIAL NOT NULL,
    "idClasse" BIGINT NOT NULL,
    "dUserGroupId" BIGINT NOT NULL,
    "recurso" VARCHAR(128) NOT NULL,
    "acao" VARCHAR(64) NOT NULL,
    "permitido" BOOLEAN NOT NULL DEFAULT true,
    "metaDados" JSONB,
    "excluido" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DPermissao_pkey" PRIMARY KEY ("chave")
);

-- CreateTable
CREATE TABLE "DTask" (
    "chave" BIGSERIAL NOT NULL,
    "idClasse" BIGINT NOT NULL,
    "idProject" BIGINT,
    "nome" VARCHAR(512) NOT NULL,
    "descricao" TEXT,
    "idStatus" BIGINT,
    "idPriority" BIGINT,
    "idTaskType" BIGINT,
    "idSprint" BIGINT,
    "idAssignee" BIGINT,
    "idCreator" BIGINT,
    "dados" JSONB,
    "excluido" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DTask_pkey" PRIMARY KEY ("chave")
);

-- CreateTable
CREATE TABLE "DProject" (
    "chave" BIGSERIAL NOT NULL,
    "idClasse" BIGINT NOT NULL,
    "idEstab" BIGINT,
    "nome" VARCHAR(255) NOT NULL,
    "descricao" TEXT,
    "dados" JSONB,
    "excluido" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DProject_pkey" PRIMARY KEY ("chave")
);

-- CreateTable
CREATE TABLE "DPedido" (
    "chave" BIGSERIAL NOT NULL,
    "idClasse" BIGINT NOT NULL,
    "idLocEscritu" BIGINT,
    "idPessoa" BIGINT,
    "valor" DECIMAL(19,4),
    "desconto" DECIMAL(19,4),
    "valorTotal" DECIMAL(19,4),
    "dataEmissao" TIMESTAMPTZ(6),
    "dataAprovacao" TIMESTAMPTZ(6),
    "dataBaixa" TIMESTAMPTZ(6),
    "aprovado" BOOLEAN NOT NULL DEFAULT false,
    "baixado" BOOLEAN NOT NULL DEFAULT false,
    "dados" JSONB,
    "metaDados" JSONB,
    "excluido" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DPedido_pkey" PRIMARY KEY ("chave")
);

-- CreateTable
CREATE TABLE "DTitulo" (
    "chave" BIGSERIAL NOT NULL,
    "idClasse" BIGINT NOT NULL,
    "idPedido" BIGINT,
    "idPessoa" BIGINT,
    "tipo" VARCHAR(8) NOT NULL,
    "valor" DECIMAL(19,4) NOT NULL,
    "valorPago" DECIMAL(19,4),
    "dataEmissao" TIMESTAMPTZ(6) NOT NULL,
    "dataVencimento" TIMESTAMPTZ(6) NOT NULL,
    "dataPagamento" TIMESTAMPTZ(6),
    "baixado" BOOLEAN NOT NULL DEFAULT false,
    "metaDados" JSONB,
    "excluido" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DTitulo_pkey" PRIMARY KEY ("chave")
);

-- CreateTable
CREATE TABLE "DMovDispo" (
    "chave" BIGSERIAL NOT NULL,
    "idClasse" BIGINT NOT NULL,
    "idDisponivel" BIGINT NOT NULL,
    "idTitulo" BIGINT,
    "tipo" VARCHAR(8) NOT NULL,
    "valor" DECIMAL(19,4) NOT NULL,
    "saldoApos" DECIMAL(19,4),
    "data" TIMESTAMPTZ(6) NOT NULL,
    "descricao" TEXT,
    "metaDados" JSONB,
    "excluido" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DMovDispo_pkey" PRIMARY KEY ("chave")
);

-- CreateTable
CREATE TABLE "DMovDepos" (
    "chave" BIGSERIAL NOT NULL,
    "idClasse" BIGINT NOT NULL,
    "idDeposito" BIGINT NOT NULL,
    "idRecurso" BIGINT,
    "tipo" VARCHAR(8) NOT NULL,
    "quantidade" DECIMAL(19,4) NOT NULL,
    "custo" DECIMAL(19,4),
    "data" TIMESTAMPTZ(6) NOT NULL,
    "descricao" TEXT,
    "metaDados" JSONB,
    "excluido" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DMovDepos_pkey" PRIMARY KEY ("chave")
);

-- CreateTable
CREATE TABLE "DSolicita" (
    "chave" BIGSERIAL NOT NULL,
    "idClasse" BIGINT NOT NULL,
    "idOrigem" BIGINT,
    "idDestino" BIGINT,
    "idSolicitante" BIGINT,
    "status" VARCHAR(16) NOT NULL,
    "data" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observacao" TEXT,
    "metaDados" JSONB,
    "excluido" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DSolicita_pkey" PRIMARY KEY ("chave")
);

-- CreateTable
CREATE TABLE "DRequisic" (
    "chave" BIGSERIAL NOT NULL,
    "idClasse" BIGINT NOT NULL,
    "idDeposito" BIGINT,
    "idCentroCusto" BIGINT,
    "idSolicitante" BIGINT,
    "status" VARCHAR(16) NOT NULL,
    "data" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observacao" TEXT,
    "metaDados" JSONB,
    "excluido" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DRequisic_pkey" PRIMARY KEY ("chave")
);

-- CreateTable
CREATE TABLE "DVFS" (
    "chave" BIGSERIAL NOT NULL,
    "idClasse" BIGINT NOT NULL,
    "chaveScript" INTEGER NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "conteudo" TEXT NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "metaDados" JSONB,
    "criadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DVFS_pkey" PRIMARY KEY ("chave")
);

-- CreateIndex
CREATE INDEX "DClasse_idPai_idx" ON "DClasse"("idPai");

-- CreateIndex
CREATE INDEX "DClasse_codigo_idx" ON "DClasse"("codigo");

-- CreateIndex
CREATE INDEX "DClasse_excluido_inativo_idx" ON "DClasse"("excluido", "inativo");

-- CreateIndex
CREATE INDEX "DEntidade_idClasse_idx" ON "DEntidade"("idClasse");

-- CreateIndex
CREATE INDEX "DEntidade_idEstab_idx" ON "DEntidade"("idEstab");

-- CreateIndex
CREATE INDEX "DEntidade_idLocEscritu_idx" ON "DEntidade"("idLocEscritu");

-- CreateIndex
CREATE INDEX "DEntidade_dUserGroupId_idx" ON "DEntidade"("dUserGroupId");

-- CreateIndex
CREATE INDEX "DEntidade_cpfCnpj_idx" ON "DEntidade"("cpfCnpj");

-- CreateIndex
CREATE INDEX "DEntidade_excluido_idClasse_idx" ON "DEntidade"("excluido", "idClasse");

-- CreateIndex
CREATE INDEX "DTabela_idClasse_idx" ON "DTabela"("idClasse");

-- CreateIndex
CREATE INDEX "DTabela_dEntidadeId_idx" ON "DTabela"("dEntidadeId");

-- CreateIndex
CREATE INDEX "DTabela_idLocEscrituracao_idx" ON "DTabela"("idLocEscrituracao");

-- CreateIndex
CREATE INDEX "DTabela_excluido_idClasse_idx" ON "DTabela"("excluido", "idClasse");

-- CreateIndex
CREATE INDEX "DVincula_idClasse_idx" ON "DVincula"("idClasse");

-- CreateIndex
CREATE INDEX "DVincula_idLocEscritu_idx" ON "DVincula"("idLocEscritu");

-- CreateIndex
CREATE INDEX "DVincula_idEntidade_idx" ON "DVincula"("idEntidade");

-- CreateIndex
CREATE INDEX "DVincula_idTabela_idx" ON "DVincula"("idTabela");

-- CreateIndex
CREATE INDEX "DVincula_idLocEscritu_idClasse_idx" ON "DVincula"("idLocEscritu", "idClasse");

-- CreateIndex
CREATE INDEX "DVincula_excluido_idClasse_idx" ON "DVincula"("excluido", "idClasse");

-- CreateIndex
CREATE INDEX "DEvento_idClasse_idx" ON "DEvento"("idClasse");

-- CreateIndex
CREATE INDEX "DEvento_idEntidade_idx" ON "DEvento"("idEntidade");

-- CreateIndex
CREATE INDEX "DEvento_criadoEm_idx" ON "DEvento"("criadoEm");

-- CreateIndex
CREATE INDEX "DEvento_idClasse_criadoEm_idx" ON "DEvento"("idClasse", "criadoEm" DESC);

-- CreateIndex
CREATE INDEX "DRecurso_idClasse_idx" ON "DRecurso"("idClasse");

-- CreateIndex
CREATE INDEX "DRecurso_excluido_idClasse_idx" ON "DRecurso"("excluido", "idClasse");

-- CreateIndex
CREATE UNIQUE INDEX "DUserGroup_usuario_key" ON "DUserGroup"("usuario");

-- CreateIndex
CREATE INDEX "DUserGroup_idClasse_idx" ON "DUserGroup"("idClasse");

-- CreateIndex
CREATE INDEX "DUserGroup_usuario_idx" ON "DUserGroup"("usuario");

-- CreateIndex
CREATE INDEX "DUserGroup_email_idx" ON "DUserGroup"("email");

-- CreateIndex
CREATE INDEX "DPermissao_dUserGroupId_idx" ON "DPermissao"("dUserGroupId");

-- CreateIndex
CREATE INDEX "DPermissao_recurso_idx" ON "DPermissao"("recurso");

-- CreateIndex
CREATE INDEX "DTask_idClasse_idx" ON "DTask"("idClasse");

-- CreateIndex
CREATE INDEX "DTask_idProject_idx" ON "DTask"("idProject");

-- CreateIndex
CREATE INDEX "DTask_idStatus_idx" ON "DTask"("idStatus");

-- CreateIndex
CREATE INDEX "DTask_idAssignee_idx" ON "DTask"("idAssignee");

-- CreateIndex
CREATE INDEX "DTask_idSprint_idx" ON "DTask"("idSprint");

-- CreateIndex
CREATE INDEX "DTask_excluido_idProject_idx" ON "DTask"("excluido", "idProject");

-- CreateIndex
CREATE INDEX "DProject_idClasse_idx" ON "DProject"("idClasse");

-- CreateIndex
CREATE INDEX "DProject_idEstab_idx" ON "DProject"("idEstab");

-- CreateIndex
CREATE INDEX "DProject_excluido_idEstab_idx" ON "DProject"("excluido", "idEstab");

-- CreateIndex
CREATE INDEX "DPedido_idClasse_idx" ON "DPedido"("idClasse");

-- CreateIndex
CREATE INDEX "DPedido_idLocEscritu_idx" ON "DPedido"("idLocEscritu");

-- CreateIndex
CREATE INDEX "DPedido_idPessoa_idx" ON "DPedido"("idPessoa");

-- CreateIndex
CREATE INDEX "DPedido_aprovado_baixado_idx" ON "DPedido"("aprovado", "baixado");

-- CreateIndex
CREATE INDEX "DPedido_excluido_idClasse_aprovado_idx" ON "DPedido"("excluido", "idClasse", "aprovado");

-- CreateIndex
CREATE INDEX "DTitulo_idClasse_idx" ON "DTitulo"("idClasse");

-- CreateIndex
CREATE INDEX "DTitulo_idPessoa_idx" ON "DTitulo"("idPessoa");

-- CreateIndex
CREATE INDEX "DTitulo_tipo_baixado_idx" ON "DTitulo"("tipo", "baixado");

-- CreateIndex
CREATE INDEX "DTitulo_dataVencimento_idx" ON "DTitulo"("dataVencimento");

-- CreateIndex
CREATE INDEX "DMovDispo_idClasse_idx" ON "DMovDispo"("idClasse");

-- CreateIndex
CREATE INDEX "DMovDispo_idDisponivel_data_idx" ON "DMovDispo"("idDisponivel", "data");

-- CreateIndex
CREATE INDEX "DMovDispo_data_idx" ON "DMovDispo"("data");

-- CreateIndex
CREATE INDEX "DMovDepos_idClasse_idx" ON "DMovDepos"("idClasse");

-- CreateIndex
CREATE INDEX "DMovDepos_idDeposito_data_idx" ON "DMovDepos"("idDeposito", "data");

-- CreateIndex
CREATE INDEX "DMovDepos_idRecurso_idx" ON "DMovDepos"("idRecurso");

-- CreateIndex
CREATE INDEX "DSolicita_idClasse_idx" ON "DSolicita"("idClasse");

-- CreateIndex
CREATE INDEX "DSolicita_idOrigem_idx" ON "DSolicita"("idOrigem");

-- CreateIndex
CREATE INDEX "DSolicita_idDestino_idx" ON "DSolicita"("idDestino");

-- CreateIndex
CREATE INDEX "DSolicita_status_idx" ON "DSolicita"("status");

-- CreateIndex
CREATE INDEX "DRequisic_idClasse_idx" ON "DRequisic"("idClasse");

-- CreateIndex
CREATE INDEX "DRequisic_idDeposito_idx" ON "DRequisic"("idDeposito");

-- CreateIndex
CREATE INDEX "DRequisic_idCentroCusto_idx" ON "DRequisic"("idCentroCusto");

-- CreateIndex
CREATE INDEX "DRequisic_status_idx" ON "DRequisic"("status");

-- CreateIndex
CREATE INDEX "DVFS_idClasse_chaveScript_ativo_idx" ON "DVFS"("idClasse", "chaveScript", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "DVFS_idClasse_chaveScript_versao_key" ON "DVFS"("idClasse", "chaveScript", "versao");

-- AddForeignKey
ALTER TABLE "DClasse" ADD CONSTRAINT "DClasse_idPai_fkey" FOREIGN KEY ("idPai") REFERENCES "DClasse"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DEntidade" ADD CONSTRAINT "DEntidade_idClasse_fkey" FOREIGN KEY ("idClasse") REFERENCES "DClasse"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DEntidade" ADD CONSTRAINT "DEntidade_idEstab_fkey" FOREIGN KEY ("idEstab") REFERENCES "DEntidade"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DEntidade" ADD CONSTRAINT "DEntidade_idLocEscritu_fkey" FOREIGN KEY ("idLocEscritu") REFERENCES "DEntidade"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DEntidade" ADD CONSTRAINT "DEntidade_dUserGroupId_fkey" FOREIGN KEY ("dUserGroupId") REFERENCES "DUserGroup"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DTabela" ADD CONSTRAINT "DTabela_idClasse_fkey" FOREIGN KEY ("idClasse") REFERENCES "DClasse"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DTabela" ADD CONSTRAINT "DTabela_dEntidadeId_fkey" FOREIGN KEY ("dEntidadeId") REFERENCES "DEntidade"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DVincula" ADD CONSTRAINT "DVincula_idClasse_fkey" FOREIGN KEY ("idClasse") REFERENCES "DClasse"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DVincula" ADD CONSTRAINT "DVincula_idLocEscritu_fkey" FOREIGN KEY ("idLocEscritu") REFERENCES "DEntidade"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DVincula" ADD CONSTRAINT "DVincula_idEntidade_fkey" FOREIGN KEY ("idEntidade") REFERENCES "DEntidade"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DVincula" ADD CONSTRAINT "DVincula_idTabela_fkey" FOREIGN KEY ("idTabela") REFERENCES "DTabela"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DEvento" ADD CONSTRAINT "DEvento_idClasse_fkey" FOREIGN KEY ("idClasse") REFERENCES "DClasse"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DEvento" ADD CONSTRAINT "DEvento_idEntidade_fkey" FOREIGN KEY ("idEntidade") REFERENCES "DEntidade"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DRecurso" ADD CONSTRAINT "DRecurso_idClasse_fkey" FOREIGN KEY ("idClasse") REFERENCES "DClasse"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DUserGroup" ADD CONSTRAINT "DUserGroup_idClasse_fkey" FOREIGN KEY ("idClasse") REFERENCES "DClasse"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DPermissao" ADD CONSTRAINT "DPermissao_idClasse_fkey" FOREIGN KEY ("idClasse") REFERENCES "DClasse"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DPermissao" ADD CONSTRAINT "DPermissao_dUserGroupId_fkey" FOREIGN KEY ("dUserGroupId") REFERENCES "DUserGroup"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DTask" ADD CONSTRAINT "DTask_idClasse_fkey" FOREIGN KEY ("idClasse") REFERENCES "DClasse"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DTask" ADD CONSTRAINT "DTask_idProject_fkey" FOREIGN KEY ("idProject") REFERENCES "DProject"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DTask" ADD CONSTRAINT "DTask_idAssignee_fkey" FOREIGN KEY ("idAssignee") REFERENCES "DEntidade"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DTask" ADD CONSTRAINT "DTask_idCreator_fkey" FOREIGN KEY ("idCreator") REFERENCES "DEntidade"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DProject" ADD CONSTRAINT "DProject_idClasse_fkey" FOREIGN KEY ("idClasse") REFERENCES "DClasse"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DProject" ADD CONSTRAINT "DProject_idEstab_fkey" FOREIGN KEY ("idEstab") REFERENCES "DEntidade"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DPedido" ADD CONSTRAINT "DPedido_idClasse_fkey" FOREIGN KEY ("idClasse") REFERENCES "DClasse"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DPedido" ADD CONSTRAINT "DPedido_idPessoa_fkey" FOREIGN KEY ("idPessoa") REFERENCES "DEntidade"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DPedido" ADD CONSTRAINT "DPedido_idLocEscritu_fkey" FOREIGN KEY ("idLocEscritu") REFERENCES "DEntidade"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DTitulo" ADD CONSTRAINT "DTitulo_idClasse_fkey" FOREIGN KEY ("idClasse") REFERENCES "DClasse"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DTitulo" ADD CONSTRAINT "DTitulo_idPessoa_fkey" FOREIGN KEY ("idPessoa") REFERENCES "DEntidade"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DMovDispo" ADD CONSTRAINT "DMovDispo_idClasse_fkey" FOREIGN KEY ("idClasse") REFERENCES "DClasse"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DMovDispo" ADD CONSTRAINT "DMovDispo_idDisponivel_fkey" FOREIGN KEY ("idDisponivel") REFERENCES "DEntidade"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DMovDepos" ADD CONSTRAINT "DMovDepos_idClasse_fkey" FOREIGN KEY ("idClasse") REFERENCES "DClasse"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DMovDepos" ADD CONSTRAINT "DMovDepos_idDeposito_fkey" FOREIGN KEY ("idDeposito") REFERENCES "DEntidade"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DSolicita" ADD CONSTRAINT "DSolicita_idClasse_fkey" FOREIGN KEY ("idClasse") REFERENCES "DClasse"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DRequisic" ADD CONSTRAINT "DRequisic_idClasse_fkey" FOREIGN KEY ("idClasse") REFERENCES "DClasse"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;
