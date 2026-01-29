import type { PrismaClient } from "@prisma/client";
import { SendStatus } from "@prisma/client";
import type { EnvConfig } from "../config.js";
import { generateRadarChartPng } from "../radar/generate.js";
import { fetchRadarData, RadarFetchError, type RadarFetchConfig } from "../radar/fetch.js";
import { logError } from "../logger.js";
import { getRadarSettings } from "../db/settings.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const BASE_RETRY_MINUTES = 10;
const MAX_RETRY_MINUTES = 60;
const MAX_SCHEDULE_RETRIES = 2;
const FAILURE_NOTIFY_COOLDOWN_MINUTES = 30;
const IN_PROGRESS_LOCK_MINUTES = 10;

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

const buildRadarFetchConfig = (
  config: EnvConfig,
  token: string | null,
  mode: RadarFetchConfig["mode"]
): RadarFetchConfig => {
  return {
    mode,
    token,
    publicBaseUrl: config.radar.publicBaseUrl,
    tokenBaseUrl: config.radar.tokenBaseUrl,
    timeoutMs: config.radar.httpTimeoutMs,
    retryMax: config.radar.retryMax,
    retryBaseDelayMs: config.radar.retryBaseDelayMs,
  };
};

const updateScheduleRetry = async (
  prisma: PrismaClient,
  scheduleId: number,
  retryCount: number,
  nowMs: number
) => {
  const nextRetryMinutes = getRetryDelayMinutes(Math.min(retryCount + 1, MAX_SCHEDULE_RETRIES));
  const nextRetryAt = new Date(nowMs + nextRetryMinutes * 60 * 1000);
  await prisma.targetSchedule.update({
    where: { id: scheduleId },
    data: {
      nextRetryAt,
      retryCount: Math.min(retryCount + 1, MAX_SCHEDULE_RETRIES),
      inProgressUntil: null,
    },
  });
};

const updateTargetFailure = async (prisma: PrismaClient, targetChatId: number, now: Date) => {
  await prisma.targetChat.update({
    where: { id: targetChatId },
    data: {
      lastErrorAt: now,
      failCount: { increment: 1 },
      notifyCooldownUntil: new Date(now.getTime() + FAILURE_NOTIFY_COOLDOWN_MINUTES * 60 * 1000),
    },
  });
};

const updateTargetSuccess = async (prisma: PrismaClient, targetChatId: number, now: Date) => {
  await prisma.targetChat.update({
    where: { id: targetChatId },
    data: {
      lastSuccessAt: now,
      failCount: 0,
      notifyCooldownUntil: null,
    },
  });
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
      where: {
        targetChat: { isEnabled: true },
        OR: [{ inProgressUntil: null }, { inProgressUntil: { lt: now } }],
      },
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
      const intervalMinutes = Math.max(schedule.intervalMinutes, 3);
      return elapsedMs >= intervalMinutes * 60 * 1000;
    });

    if (!dueSchedules.length) {
      console.log("scheduler_tick_no_due_targets");
      return;
    }

    const settings = await getRadarSettings(prisma);
    const mode = settings.radarMode ?? config.radar.mode;
    const token = settings.radarApiToken ?? config.radar.apiToken;
    if (mode === "token" && !token) {
      await logError("scheduler_missing_radar_token", { scope: "scheduler_token_missing" });
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
      const radarConfig = buildRadarFetchConfig(config, token, mode);
      const radarData = await fetchRadarData({ dateRange: "1d", location: "IR" }, radarConfig);
      buffer = await generateRadarChartPng(radarData.points, config.defaultTimezone);
    } catch (error) {
      const errorCode = error instanceof RadarFetchError ? error.code : "CHART_RENDER_FAILED";
      await logError("scheduler_capture_failed", { scope: "scheduler_capture_failed", errorCode, error });
      const retryUpdates = pendingSchedules.map((schedule) =>
        updateScheduleRetry(prisma, schedule.id, schedule.retryCount ?? 0, nowMs)
      );
      const targetUpdates = pendingSchedules.map((schedule) =>
        updateTargetFailure(prisma, schedule.targetChatId, now)
      );
      await Promise.all([...retryUpdates, ...targetUpdates]);
      return;
    }
    const caption = `Cloudflare Radar 🇮🇷\n${formatTimestamp(config.defaultTimezone)}`;

    for (const schedule of pendingSchedules) {
      const sentAt = new Date();
      const lockUntil = new Date(sentAt.getTime() + IN_PROGRESS_LOCK_MINUTES * 60 * 1000);
      await prisma.targetSchedule.update({
        where: { id: schedule.id },
        data: { inProgressUntil: lockUntil },
      });
      try {
        await sender.sendChartToChat(schedule.targetChat.chatId, caption, buffer);
        await prisma.targetSchedule.update({
          where: { id: schedule.id },
          data: { lastSentAt: sentAt, nextRetryAt: null, retryCount: 0, inProgressUntil: null },
        });
        await updateTargetSuccess(prisma, schedule.targetChatId, sentAt);
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
        await logError("scheduler_send_failed", { scope: "scheduler_send_failed", error });
        await updateScheduleRetry(prisma, schedule.id, schedule.retryCount ?? 0, sentAt.getTime());
        await updateTargetFailure(prisma, schedule.targetChatId, sentAt);
        await prisma.sendLog.create({
          data: {
            targetChatId: schedule.targetChatId,
            sentAt,
            status: SendStatus.FAIL,
            error: error instanceof Error ? error.stack ?? error.message : "Unknown error",
          },
        });
      }
    }
  } finally {
    state.isTickRunning = false;
  }
};
