-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN     "isSandbox" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "email" TEXT,
ADD COLUMN     "webhookSecret" TEXT;
