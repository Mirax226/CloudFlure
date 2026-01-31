import type { PrismaClient } from "@prisma/client";
import { SendStatus } from "@prisma/client";
import type { EnvConfig } from "../config.js";
import { generateRadarChartPng } from "../radar/generate.js";
import {
  fetchRadarData,
  RadarFetchError,
  type RadarFetchConfig,
  type RadarChartData,
} from "../radar/fetch.js";
import { logError, logInfo, logWarn } from "../logger.js";
import { getRadarSettings } from "../db/settings.js";
import { isRadarTokenValidFormat } from "../radar/client.js";
import { getSchedulerBackoffMinutes } from "./backoff.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
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

const buildRadarFetchConfig = (
  config: EnvConfig,
  token: string | null,
  mode: RadarFetchConfig["mode"],
  dateRangePreset: RadarFetchConfig["dateRangePreset"]
): RadarFetchConfig => ({
  mode,
  token,
  timeoutMs: config.radar.httpTimeoutMs,
  dateRangePreset,
});

const updateScheduleFailure = async (
  prisma: PrismaClient,
  scheduleId: number,
  currentFailCount: number,
  now: Date
) => {
  const nextFailCount = currentFailCount + 1;
  const backoffMinutes = getSchedulerBackoffMinutes(nextFailCount);
  const nextRetryAt = new Date(now.getTime() + backoffMinutes * 60 * 1000);
  await prisma.targetSchedule.update({
    where: { id: scheduleId },
    data: {
      failCount: nextFailCount,
      nextRetryAt,
      inProgressUntil: null,
    },
  });
};

const updateScheduleSuccess = async (prisma: PrismaClient, scheduleId: number, sentAt: Date) => {
  await prisma.targetSchedule.update({
    where: { id: scheduleId },
    data: { lastSentAt: sentAt, nextRetryAt: null, failCount: 0, inProgressUntil: null },
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

const buildChartBuffer = async (
  config: EnvConfig,
  token: string | null,
  mode: RadarFetchConfig["mode"],
  dateRangePreset: RadarFetchConfig["dateRangePreset"]
): Promise<{ buffer: Buffer; radarData: RadarChartData }> => {
  const radarConfig = buildRadarFetchConfig(config, token, mode, dateRangePreset);
  const radarData = await fetchRadarData({ limit: 10 }, radarConfig);
  const buffer = await generateRadarChartPng(
    { labels: radarData.labels, values: radarData.values, title: radarData.label },
    config.defaultTimezone
  );
  return { buffer, radarData };
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
      await logInfo("scheduler_tick_no_targets");
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

    const pendingSchedules = dueSchedules.slice(0, config.maxSendsPerTick);
    if (dueSchedules.length > pendingSchedules.length) {
      console.log("scheduler_tick_rate_limited", {
        dueCount: dueSchedules.length,
        processedCount: pendingSchedules.length,
      });
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
        const settings = await getRadarSettings(prisma, schedule.targetChat.createdByUserId);
        const mode = settings.radarMode ?? config.radar.mode;
        const token = settings.radarApiToken ?? config.radar.apiToken;
        const dateRangePreset = settings.radarDateRange ?? "D7";
        if (mode === "token" && !token) {
          await logError("scheduler_missing_radar_token", {
            scope: "scheduler_token_missing",
            targetChatId: schedule.targetChatId,
          });
          await updateScheduleFailure(prisma, schedule.id, schedule.failCount ?? 0, sentAt);
          await updateTargetFailure(prisma, schedule.targetChatId, sentAt);
          await prisma.sendLog.create({
            data: {
              targetChatId: schedule.targetChatId,
              sentAt,
              status: SendStatus.FAIL,
              error: "RADAR_TOKEN_MISSING",
            },
          });
          continue;
        }
        if (mode === "token" && token && !isRadarTokenValidFormat(token)) {
          await logWarn("scheduler_invalid_radar_token", {
            targetChatId: schedule.targetChatId,
            mode,
          });
          await updateScheduleFailure(prisma, schedule.id, schedule.failCount ?? 0, sentAt);
          await updateTargetFailure(prisma, schedule.targetChatId, sentAt);
          await prisma.sendLog.create({
            data: {
              targetChatId: schedule.targetChatId,
              sentAt,
              status: SendStatus.FAIL,
              error: "RADAR_TOKEN_INVALID",
            },
          });
          continue;
        }

        const result = await buildChartBuffer(config, token, mode, dateRangePreset);
        await sender.sendChartToChat(schedule.targetChat.chatId, caption, result.buffer);
        await updateScheduleSuccess(prisma, schedule.id, sentAt);
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
        const errorCode = error instanceof RadarFetchError ? error.code : "CHART_RENDER_FAILED";
        await logError(
          "scheduler_send_failed",
          { scope: "scheduler_send_failed", errorCode, targetChatId: schedule.targetChatId },
          error
        );
        await updateScheduleFailure(prisma, schedule.id, schedule.failCount ?? 0, sentAt);
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
