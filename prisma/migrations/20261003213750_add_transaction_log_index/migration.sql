/*
  Warnings:

  - A unique constraint covering the columns `[txHash,logIndex]` on the table `Transaction` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `logIndex` to the `Transaction` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Transaction_txHash_key";

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "logIndex" INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_txHash_logIndex_key" ON "Transaction"("txHash", "logIndex");
