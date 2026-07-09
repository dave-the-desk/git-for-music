-- CreateEnum
CREATE TYPE "PluginVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "PluginBundleKind" AS ENUM ('SINGLE_MODULE', 'ZIP_BUNDLE');

-- AlterTable
ALTER TABLE "PluginMetadata"
  ADD COLUMN "displayName" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "ownerId" TEXT,
  ADD COLUMN "visibility" "PluginVisibility" NOT NULL DEFAULT 'PRIVATE',
  ADD COLUMN "moduleObjectKey" TEXT,
  ADD COLUMN "bundlePrefix" TEXT,
  ADD COLUMN "bundleKind" "PluginBundleKind",
  ADD COLUMN "sizeBytes" BIGINT,
  ADD COLUMN "checksum" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing system plugins remain public.
UPDATE "PluginMetadata"
SET "visibility" = 'PUBLIC'
WHERE "ownerId" IS NULL;

-- CreateTable
CREATE TABLE "PluginGrant" (
    "id" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "demoId" TEXT NOT NULL,
    "grantedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "PluginGrant_pluginId_demoId_key" ON "PluginGrant"("pluginId", "demoId");

-- CreateIndex
CREATE INDEX "PluginGrant_demoId_idx" ON "PluginGrant"("demoId");

-- CreateIndex
CREATE INDEX "PluginGrant_pluginId_idx" ON "PluginGrant"("pluginId");

-- CreateIndex
CREATE INDEX "PluginMetadata_ownerId_idx" ON "PluginMetadata"("ownerId");

-- AddForeignKey
ALTER TABLE "PluginMetadata" ADD CONSTRAINT "PluginMetadata_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PluginGrant" ADD CONSTRAINT "PluginGrant_pluginId_fkey" FOREIGN KEY ("pluginId") REFERENCES "PluginMetadata"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PluginGrant" ADD CONSTRAINT "PluginGrant_demoId_fkey" FOREIGN KEY ("demoId") REFERENCES "Demo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PluginGrant" ADD CONSTRAINT "PluginGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON UPDATE CASCADE;
