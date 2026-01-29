-- CreateTable
CREATE TABLE "AppSetting" (
    "id" SERIAL NOT NULL,
    "radarApiToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);
