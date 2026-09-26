-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "returnItems" TEXT,
ADD COLUMN     "returnsAmount" DECIMAL(10,2),
ADD COLUMN     "returnsCount" INTEGER NOT NULL DEFAULT 0;
