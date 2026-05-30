-- CreateTable
CREATE TABLE "DemoUserActiveVersion" (
    "id" TEXT NOT NULL,
    "demoId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activeVersionId" TEXT NOT NULL,
    "isFollowingHead" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemoUserActiveVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DemoUserActiveVersion_demoId_userId_key" ON "DemoUserActiveVersion"("demoId", "userId");

-- AddForeignKey
ALTER TABLE "DemoUserActiveVersion" ADD CONSTRAINT "DemoUserActiveVersion_demoId_fkey" FOREIGN KEY ("demoId") REFERENCES "Demo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoUserActiveVersion" ADD CONSTRAINT "DemoUserActiveVersion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoUserActiveVersion" ADD CONSTRAINT "DemoUserActiveVersion_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "DemoVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
