-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "name" TEXT,
ADD COLUMN     "watchers" INTEGER NOT NULL DEFAULT 0;
