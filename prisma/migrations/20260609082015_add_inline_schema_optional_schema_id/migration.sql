-- DropForeignKey
ALTER TABLE "Extraction" DROP CONSTRAINT "Extraction_schemaId_fkey";

-- AlterTable
ALTER TABLE "Extraction" ADD COLUMN     "inlineSchema" JSONB,
ALTER COLUMN "schemaId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Extraction" ADD CONSTRAINT "Extraction_schemaId_fkey" FOREIGN KEY ("schemaId") REFERENCES "Schema"("id") ON DELETE SET NULL ON UPDATE CASCADE;
