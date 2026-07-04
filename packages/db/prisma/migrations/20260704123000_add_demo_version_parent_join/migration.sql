-- CreateTable
CREATE TABLE "DemoVersionParent" (
    "versionId" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "order" INTEGER NOT NULL
);

-- CreateIndex
CREATE INDEX "DemoVersionParent_versionId_order_idx" ON "DemoVersionParent"("versionId", "order");

-- CreateIndex
CREATE INDEX "DemoVersionParent_parentId_order_idx" ON "DemoVersionParent"("parentId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "DemoVersionParent_versionId_parentId_order_key" ON "DemoVersionParent"("versionId", "parentId", "order");

-- AddForeignKey
ALTER TABLE "DemoVersionParent" ADD CONSTRAINT "DemoVersionParent_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DemoVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoVersionParent" ADD CONSTRAINT "DemoVersionParent_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "DemoVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
