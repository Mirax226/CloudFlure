-- CreateEnum
CREATE TYPE "RadarDateRange" AS ENUM ('D1', 'D2', 'D3', 'D7', 'D14', 'D21', 'M1', 'M2', 'M3', 'Y1');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "radarDateRange" "RadarDateRange" NOT NULL DEFAULT 'D7';

-- AlterTable
ALTER TABLE "AppSetting" ADD COLUMN     "radarDateRange" "RadarDateRange" NOT NULL DEFAULT 'D7';
