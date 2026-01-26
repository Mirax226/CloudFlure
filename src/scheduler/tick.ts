import type { Prisma, PrismaClient } from "@prisma/client";
import type { EnvConfig } from "../config.js";
import { captureRadarChart } from "../screenshot/capture.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type Sender = {
  sendChartToTargets: (userChatId: bigint, caption: string, buffer: Buffer) => Promise<void>;
};

export type SchedulerState = {
  inMemoryLock: boolean;
};

const lockKey = "scheduler_lock";

const acquireDbLock = async (prisma: PrismaClient, ttlMs: number): Promise<boolean> => {
  const now = new Date();
  const lock = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.state.findUnique({ where: { key: lockKey } });
    if (existing) {
      const expiresAt = new Date(existing.updatedAt.getTime() + ttlMs);
      if (expiresAt > now) {
        return false;
      }
    }
    await tx.state.upsert({
      where: { key: lockKey },
      update: { value: now.toISOString() },
      create: { key: lockKey, value: now.toISOString() },
    });
    return true;
  });
  return lock;
};

const formatTimestamp = (timezone: string): string => {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return formatter.format(new Date()).replace(",", "");
};

export const runSchedulerTick = async (
  prisma: PrismaClient,
  config: EnvConfig,
  sender: Sender,
  state: SchedulerState
) => {
  if (state.inMemoryLock) {
    console.log("scheduler_tick_skipped", { reason: "in_memory_lock" });
    return;
  }

  state.inMemoryLock = true;
  try {
    const hasDbLock = await acquireDbLock(prisma, 55_000);
    if (!hasDbLock) {
      console.log("scheduler_tick_skipped", { reason: "db_lock" });
      return;
    }

    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        sendHour: currentHour,
        sendMinute: currentMinute,
      },
    });

    if (!users.length) {
      return;
    }

    const buffer = await captureRadarChart();
    const caption = `Cloudflare Radar 🇮🇷\n${formatTimestamp(config.defaultTimezone)}`;
    const runAt = new Date();
    let successCount = 0;

    for (const user of users) {
      try {
        await sender.sendChartToTargets(user.tgChatId, caption, buffer);
        successCount += 1;
        await delay(200);
      } catch (error) {
        console.error("scheduler_send_failed", { error });
        await prisma.user.update({
          where: { id: user.id },
          data: { isActive: false },
        });
      }
    }

    await prisma.jobLog.create({
      data: {
        runAt,
        status: successCount === users.length ? "SUCCESS" : "FAIL",
        error: successCount === users.length ? null : "Some sends failed",
        targetCount: users.length,
      },
    });
  } finally {
    state.inMemoryLock = false;
  }
};
