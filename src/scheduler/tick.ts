import type { PrismaClient } from "@prisma/client";
import { SendStatus } from "@prisma/client";
import type { EnvConfig } from "../config.js";
import { generateRadarChartPng } from "../radar/generate.js";
import { logError } from "../logger.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const BASE_RETRY_MINUTES = 10;
const MAX_RETRY_MINUTES = 60;

export type Sender = {
  sendChartToChat: (chatId: bigint, caption: string, buffer: Buffer) => Promise<void>;
};

export type SchedulerState = {
  isTickRunning: boolean;
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

const getRetryDelayMinutes = (attempt: number): number => {
  return Math.min(BASE_RETRY_MINUTES * attempt, MAX_RETRY_MINUTES);
};

export const runSchedulerTick = async (
  prisma: PrismaClient,
  config: EnvConfig,
  sender: Sender,
  state: SchedulerState
) => {
  if (state.isTickRunning) {
    console.log("scheduler_tick_skipped", { reason: "in_memory_lock" });
    return;
  }

  state.isTickRunning = true;
  try {
    const now = new Date();
    const schedules = await prisma.targetSchedule.findMany({
      where: { targetChat: { isEnabled: true } },
      include: { targetChat: true },
      orderBy: { updatedAt: "asc" },
    });

    if (!schedules.length) {
      console.log("scheduler_tick_no_targets");
      return;
    }

    const nowMs = now.getTime();
    const dueSchedules = schedules.filter((schedule) => {
      if (schedule.nextRetryAt && nowMs < schedule.nextRetryAt.getTime()) {
        return false;
      }
      if (!schedule.lastSentAt) {
        return true;
      }
      const elapsedMs = nowMs - schedule.lastSentAt.getTime();
      return elapsedMs >= schedule.intervalMinutes * 60 * 1000;
    });

    if (!dueSchedules.length) {
      console.log("scheduler_tick_no_due_targets");
      return;
    }

    const pendingSchedules = dueSchedules.slice(0, config.maxSendsPerTick);
    if (dueSchedules.length > pendingSchedules.length) {
      console.log("scheduler_tick_rate_limited", {
        dueCount: dueSchedules.length,
        processedCount: pendingSchedules.length,
      });
    }

    let buffer: Buffer;
    try {
      buffer = await generateRadarChartPng(config.defaultTimezone);
    } catch (error) {
      await logError("Scheduler capture failed", { scope: "scheduler_capture_failed", error });
      const retryUpdates = pendingSchedules.map((schedule) => {
        const retryCount = schedule.retryCount ?? 0;
        const nextRetryAt = new Date(
          nowMs + getRetryDelayMinutes(retryCount + 1) * 60 * 1000
        );
        return prisma.targetSchedule.update({
          where: { id: schedule.id },
          data: {
            nextRetryAt,
            retryCount: retryCount + 1,
          },
        });
      });
      await Promise.all(retryUpdates);
      return;
    }
    const caption = `Cloudflare Radar 🇮🇷\n${formatTimestamp(config.defaultTimezone)}`;

    for (const schedule of pendingSchedules) {
      const sentAt = new Date();
      try {
        await sender.sendChartToChat(schedule.targetChat.chatId, caption, buffer);
        await prisma.targetSchedule.update({
          where: { id: schedule.id },
          data: { lastSentAt: sentAt, nextRetryAt: null, retryCount: 0 },
        });
        await prisma.sendLog.create({
          data: {
            targetChatId: schedule.targetChatId,
            sentAt,
            status: SendStatus.SUCCESS,
            error: null,
          },
        });
        await delay(200);
      } catch (error) {
        await logError("Scheduler send failed", { scope: "scheduler_send_failed", error });
        const retryCount = schedule.retryCount ?? 0;
        const nextRetryAt = new Date(
          sentAt.getTime() + getRetryDelayMinutes(retryCount + 1) * 60 * 1000
        );
        await prisma.targetSchedule.update({
          where: { id: schedule.id },
          data: {
            nextRetryAt,
            retryCount: retryCount + 1,
          },
        });
        await prisma.sendLog.create({
          data: {
            targetChatId: schedule.targetChatId,
            sentAt,
            status: SendStatus.FAIL,
            error: error instanceof Error ? error.message : "Unknown error",
          },
        });
      }
    }
  } finally {
    state.isTickRunning = false;
  }
};
