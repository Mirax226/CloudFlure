import type { Prisma, PrismaClient } from "@prisma/client";
import type { EnvConfig } from "../config.js";
import { captureRadarChart } from "../screenshot/capture.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type Sender = {
  sendChartToChat: (chatId: bigint, caption: string, buffer: Buffer) => Promise<void>;
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
    const targets = await prisma.target.findMany({
      where: { isEnabled: true },
    });

    if (!targets.length) {
      console.log("scheduler_tick_no_targets");
      return;
    }

    const nowMs = now.getTime();
    const dueTargets = targets.filter((target) => {
      if (!target.lastSentAt) {
        return true;
      }
      const elapsedMs = nowMs - target.lastSentAt.getTime();
      return elapsedMs >= target.intervalMinutes * 60 * 1000;
    });

    if (!dueTargets.length) {
      console.log("scheduler_tick_no_due_targets");
      return;
    }

    const buffer = await captureRadarChart();
    const caption = `Cloudflare Radar 🇮🇷\n${formatTimestamp(config.defaultTimezone)}`;
    const runAt = new Date();
    let successCount = 0;

    for (const target of dueTargets) {
      try {
        await sender.sendChartToChat(target.tgChatId, caption, buffer);
        successCount += 1;
        await prisma.target.update({
          where: { id: target.id },
          data: { lastSentAt: now },
        });
        await delay(200);
      } catch (error) {
        console.error("scheduler_send_failed", { error });
      }
    }

    await prisma.jobLog.create({
      data: {
        runAt,
        status: successCount === dueTargets.length ? "SUCCESS" : "FAIL",
        error: successCount === dueTargets.length ? null : "Some sends failed",
        targetCount: dueTargets.length,
      },
    });
  } finally {
    state.inMemoryLock = false;
  }
};
