-- AlterTable
ALTER TABLE "Turn" ADD COLUMN     "clientKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Turn_clientKey_key" ON "Turn"("clientKey");
