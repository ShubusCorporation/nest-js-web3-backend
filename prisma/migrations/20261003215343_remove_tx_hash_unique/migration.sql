/*
  Warnings:

  - You are about to drop the column `logIndex` on the `Transaction` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Transaction_txHash_logIndex_key";

-- AlterTable
ALTER TABLE "Transaction" DROP COLUMN "logIndex";
