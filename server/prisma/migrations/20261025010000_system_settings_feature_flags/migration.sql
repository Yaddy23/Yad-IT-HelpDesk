-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN     "featureFlags" JSONB NOT NULL DEFAULT '{}';
