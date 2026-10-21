-- AlterEnum
ALTER TYPE "PaymentProvider" ADD VALUE 'MANUAL';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "notifyCustomer" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "PanelIntegration" ADD COLUMN     "namesApiKeyEnc" TEXT,
ADD COLUMN     "namesApiUrl" TEXT;
