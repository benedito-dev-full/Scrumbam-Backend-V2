-- AlterTable
ALTER TABLE "DProject" ADD COLUMN     "idPai" BIGINT,
ADD COLUMN     "privado" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "DProject_idPai_idx" ON "DProject"("idPai");

-- CreateIndex
CREATE INDEX "DProject_excluido_idPai_idx" ON "DProject"("excluido", "idPai");

-- AddForeignKey
ALTER TABLE "DProject" ADD CONSTRAINT "DProject_idPai_fkey" FOREIGN KEY ("idPai") REFERENCES "DProject"("chave") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Migration down (rollback manual — ADR-V2-051)
-- DROP INDEX IF EXISTS "DProject_excluido_idPai_idx";
-- DROP INDEX IF EXISTS "DProject_idPai_idx";
-- ALTER TABLE "DProject" DROP CONSTRAINT IF EXISTS "DProject_idPai_fkey";
-- ALTER TABLE "DProject" DROP COLUMN IF EXISTS "privado";
-- ALTER TABLE "DProject" DROP COLUMN IF EXISTS "idPai";
