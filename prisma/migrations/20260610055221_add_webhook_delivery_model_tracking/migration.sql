-- Add modelUsed to Extraction for per-model cost tracking
ALTER TABLE "Extraction" ADD COLUMN "modelUsed" TEXT;

-- Create WebhookDelivery table (append-only delivery log)
CREATE TABLE "WebhookDelivery" (
  "id"            TEXT         NOT NULL,
  "extractionId"  TEXT         NOT NULL,
  "workspaceId"   TEXT         NOT NULL,
  "url"           TEXT         NOT NULL,
  "payload"       JSONB        NOT NULL,
  "status"        TEXT         NOT NULL DEFAULT 'pending',
  "httpStatus"    INTEGER,
  "responseBody"  TEXT,
  "attemptNumber" INTEGER      NOT NULL DEFAULT 1,
  "deliveredAt"   TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebhookDelivery_extractionId_idx" ON "WebhookDelivery"("extractionId");
CREATE INDEX "WebhookDelivery_workspaceId_idx"  ON "WebhookDelivery"("workspaceId");
CREATE INDEX "WebhookDelivery_status_idx"       ON "WebhookDelivery"("status");

ALTER TABLE "WebhookDelivery"
  ADD CONSTRAINT "WebhookDelivery_extractionId_fkey"
    FOREIGN KEY ("extractionId") REFERENCES "Extraction"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebhookDelivery"
  ADD CONSTRAINT "WebhookDelivery_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
