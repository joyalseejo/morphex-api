-- AlterTable: add versioning fields to Schema
ALTER TABLE "Schema" ADD COLUMN "parentSchemaId" TEXT,
                      ADD COLUMN "isLatest"           BOOLEAN NOT NULL DEFAULT true,
                      ADD COLUMN "isDeprecated"        BOOLEAN NOT NULL DEFAULT false,
                      ADD COLUMN "deprecationMessage"  TEXT;

-- DropIndex (old unique constraint on workspaceId + slug)
DROP INDEX IF EXISTS "Schema_workspaceId_slug_key";

-- CreateIndex: new unique constraint includes version
CREATE UNIQUE INDEX "Schema_workspaceId_slug_version_key" ON "Schema"("workspaceId", "slug", "version");

-- CreateIndex: covering indexes for new boolean fields
CREATE INDEX "Schema_isLatest_idx" ON "Schema"("isLatest");
CREATE INDEX "Schema_parentSchemaId_idx" ON "Schema"("parentSchemaId");

-- AddForeignKey: self-referential parent/child relation
ALTER TABLE "Schema" ADD CONSTRAINT "Schema_parentSchemaId_fkey"
  FOREIGN KEY ("parentSchemaId") REFERENCES "Schema"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
