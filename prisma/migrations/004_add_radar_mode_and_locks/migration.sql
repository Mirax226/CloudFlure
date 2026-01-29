-- AlterTable
ALTER TABLE "TargetChat" ADD COLUMN     "lastErrorAt" TIMESTAMP(3),
ADD COLUMN     "lastSuccessAt" TIMESTAMP(3),
ADD COLUMN     "failCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "notifyCooldownUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TargetSchedule" ADD COLUMN     "inProgressUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TargetSchedule" ALTER COLUMN "intervalMinutes" SET DEFAULT 60;

-- AlterTable
ALTER TABLE "AppSetting" ADD COLUMN     "radarMode" TEXT;
