-- CreateEnum
CREATE TYPE "DemoVersionKind" AS ENUM ('AUTO', 'SEMANTIC', 'EXPLICIT', 'REVERT', 'BRANCH', 'MERGE');

-- AlterTable
ALTER TABLE "DemoVersion" ADD COLUMN     "kind" "DemoVersionKind" NOT NULL DEFAULT 'EXPLICIT';

-- AlterTable
ALTER TABLE "DemoVersion" ADD COLUMN     "operationSeq" INTEGER;
