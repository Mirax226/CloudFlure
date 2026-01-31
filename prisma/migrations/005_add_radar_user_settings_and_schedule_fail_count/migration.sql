-- AlterTable
ALTER TABLE "User" ADD COLUMN     "radarApiToken" TEXT,
ADD COLUMN     "radarMode" TEXT;

-- AlterTable
ALTER TABLE "TargetSchedule" ADD COLUMN     "failCount" INTEGER NOT NULL DEFAULT 0;
