-- CreateEnum
CREATE TYPE "TargetChatType" AS ENUM ('CHANNEL', 'GROUP', 'SUPERGROUP');

-- CreateEnum
CREATE TYPE "SendStatus" AS ENUM ('SUCCESS', 'FAIL');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "tgUserId" BIGINT NOT NULL,
    "privateChatId" BIGINT,
    "selectedTargetId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TargetChat" (
    "id" SERIAL NOT NULL,
    "chatId" BIGINT NOT NULL,
    "title" TEXT,
    "type" "TargetChatType" NOT NULL,
    "createdByUserId" INTEGER NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TargetChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TargetSchedule" (
    "id" SERIAL NOT NULL,
    "targetChatId" INTEGER NOT NULL,
    "intervalMinutes" INTEGER NOT NULL,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TargetSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SendLog" (
    "id" SERIAL NOT NULL,
    "targetChatId" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "status" "SendStatus" NOT NULL,
    "error" TEXT,

    CONSTRAINT "SendLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_tgUserId_key" ON "User"("tgUserId");

-- CreateIndex
CREATE UNIQUE INDEX "TargetChat_chatId_key" ON "TargetChat"("chatId");

-- CreateIndex
CREATE UNIQUE INDEX "TargetSchedule_targetChatId_key" ON "TargetSchedule"("targetChatId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_selectedTargetId_fkey" FOREIGN KEY ("selectedTargetId") REFERENCES "TargetChat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetChat" ADD CONSTRAINT "TargetChat_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetSchedule" ADD CONSTRAINT "TargetSchedule_targetChatId_fkey" FOREIGN KEY ("targetChatId") REFERENCES "TargetChat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendLog" ADD CONSTRAINT "SendLog_targetChatId_fkey" FOREIGN KEY ("targetChatId") REFERENCES "TargetChat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

