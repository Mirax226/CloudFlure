import { Bot, InputFile, session } from "grammy";
import type { Context } from "grammy";
import type { PrismaClient } from "@prisma/client";
import type { EnvConfig } from "./config.js";
import { generateRadarChartPng, ChartRenderError } from "./radar/generate.js";
import {
  fetchRadarData,
  diagnoseRadar,
  RadarFetchError,
  type RadarFetchConfig,
  type RadarMode,
  type RadarChartData,
  type RadarDiagnostics,
} from "./radar/fetch.js";
import { RadarConfigError } from "./radar/endpoints.js";
import { registerMenuHandlers, type SessionData } from "./ui/menus.js";
import { logError, logInfo, logWarn } from "./logger.js";
import { getRadarSettings } from "./db/settings.js";
import type { RadarDateRangePreset } from "./radar/dateRange.js";
import { isRadarTokenValidFormat } from "./radar/client.js";

export type BotState = {
  lastSendByUserId: Map<number, number>;
  lastRadarSourceByUserId: Map<number, "public" | "token">;
  inFlightByUserId: Map<number, Promise<void>>;
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

const resolveRadarFetchConfig = async (
  prisma: PrismaClient,
  config: EnvConfig,
  userId?: number
): Promise<{
  fetchConfig: RadarFetchConfig;
  mode: RadarMode;
  token: string | null;
  dateRangePreset: RadarDateRangePreset;
}> => {
  const settings = await getRadarSettings(prisma, userId);
  const mode = settings.radarMode ?? config.radar.mode;
  const token = settings.radarApiToken ?? config.radar.apiToken;
  const dateRangePreset = settings.radarDateRange ?? "D7";
  return {
    mode,
    token,
    dateRangePreset,
    fetchConfig: {
      mode,
      token,
      timeoutMs: config.radar.httpTimeoutMs,
      dateRangePreset,
    },
  };
};

const formatErrorCode = (status?: number): string => {
  if (!status) {
    return "RADAR_UNKNOWN";
  }
  return `RADAR_${status}`;
};

const buildUserFacingError = (error: unknown, mode?: RadarMode): string => {
  if (error instanceof RadarConfigError) {
    return "خطای تنظیمات درخواست (400). کد خطا: RADAR_400";
  }

  if (error instanceof RadarFetchError) {
    const code = formatErrorCode(error.status);
    switch (error.code) {
      case "RADAR_PUBLIC_UNSUPPORTED":
        return "Public برای این چارت فعال نیست. حالت Token رو انتخاب کن.";
      case "RADAR_TOKEN_MISSING":
        return "توکن Radar API تنظیم نشده. از منوی 🗝️ توکن رو ثبت کن.";
      case "RADAR_UNAUTHORIZED":
        if (mode === "public") {
          return "Public برای این چارت فعال نیست. حالت Token رو انتخاب کن.";
        }
        return `توکن/دسترسی نامعتبر. کد خطا: ${code}`;
      case "RADAR_BAD_REQUEST":
        return `خطای تنظیمات درخواست (400). کد خطا: ${code}`;
      case "RADAR_RATE_LIMIT":
        return `محدودیت درخواست. کد خطا: ${code}`;
      case "RADAR_TIMEOUT":
      case "RADAR_UPSTREAM":
      case "RADAR_NETWORK":
        return `مشکل موقت سرویس. کد خطا: ${code}`;
      case "RADAR_INVALID_DATA":
      case "RADAR_EMPTY_DATA":
        return `دیتای معتبر دریافت نشد. کد خطا: ${code}`;
      default:
        return `دریافت دیتا ناموفق بود. کد خطا: ${code}`;
    }
  }

  if (error instanceof ChartRenderError) {
    if (error.code === "CHART_RENDER_FAILED") {
      return "دیتا اومد ولی ساخت چارت خطا داد.";
    }
    return "دیتای معتبر برای چارت وجود نداره.";
  }

  return "یک خطای غیرمنتظره رخ داد. دوباره تلاش کن.";
};

const formatRadarDiagnostics = (diagnostics: RadarDiagnostics, lastSource?: "public" | "token") => {
  const lines = [
    `حالت تنظیم‌شده: ${diagnostics.configuredMode}`,
    `منبع مؤثر: ${diagnostics.effectiveSource ?? "نامشخص"}`,
    lastSource ? `آخرین منبع موفق: ${lastSource}` : "آخرین منبع موفق: نامشخص",
    `مسیر API: ${diagnostics.endpoint}`,
    `پارامترها: ${JSON.stringify(diagnostics.params)}`,
    `کد وضعیت: ${diagnostics.status ?? "نامشخص"}`,
    `زمان پاسخ: ${diagnostics.timingMs ?? "نامشخص"}ms`,
    `خطای کوتاه: ${diagnostics.errorSummary ?? "ندارد"}`,
  ];
  return lines.join("\n");
};

const buildChartSeries = (data: RadarChartData): { labels: string[]; values: number[]; title: string } => {
  return { labels: data.labels, values: data.values, title: data.label };
};

export const createBot = (prisma: PrismaClient, config: EnvConfig, state: BotState) => {
  const bot = new Bot<Context & { session: SessionData }>(config.botToken);

  bot.use(
    session({
      initial: (): SessionData => ({ step: null }),
    })
  );

  bot.catch((error) => {
    void logError("bot_handler_failed", {
      updateId: error.ctx?.update?.update_id,
    }, error.error);
  });

  const sendChartToChat = async (chatId: bigint | number, caption: string, buffer: Buffer) => {
    const photo = new InputFile(buffer, "radar.png");
    await bot.api.sendPhoto(Number(chatId), photo, { caption });
  };

  const runDiagnostics = async (ctx: Context, userId?: number) => {
    const { fetchConfig } = await resolveRadarFetchConfig(prisma, config, userId);
    const diagnostics = await diagnoseRadar({ limit: 10 }, fetchConfig);
    const lastSource = userId ? state.lastRadarSourceByUserId.get(userId) : undefined;
    await ctx.reply(formatRadarDiagnostics(diagnostics, lastSource));
  };

  const sendNow = async (ctx: Context) => {
    const tgUserId = ctx.from?.id;
    if (!tgUserId) {
      await ctx.reply("کاربر نامعتبره، دوباره تلاش کن.");
      return;
    }
    const inFlight = state.inFlightByUserId.get(tgUserId);
    if (inFlight) {
      await ctx.reply("در حال آماده‌سازی... کمی صبر کن ⏳");
      return;
    }

    const task = (async () => {
    const now = Date.now();
    const lastSent = state.lastSendByUserId.get(tgUserId);
    if (lastSent && now - lastSent < config.screenshotCooldownSec * 1000) {
      await ctx.reply("کمی صبر کن تا دوباره ارسال کنیم ⏳");
      return;
    }

    const user = await prisma.user.upsert({
      where: { tgUserId: BigInt(tgUserId) },
      update: {},
      create: { tgUserId: BigInt(tgUserId) },
    });

    const privateChatId = user.privateChatId ?? (ctx.chat?.id ? BigInt(ctx.chat.id) : null);
    if (!privateChatId) {
      await ctx.reply("چت نامعتبره، دوباره تلاش کن.");
      return;
    }

    const selectedTarget = user.selectedTargetId
      ? await prisma.targetChat.findUnique({ where: { id: user.selectedTargetId } })
      : null;
    const shouldSendToTarget = Boolean(selectedTarget?.isEnabled);

    const { fetchConfig, mode, token, dateRangePreset } = await resolveRadarFetchConfig(prisma, config, user.id);
    if (mode === "token" && !token) {
      await ctx.reply("توکن Radar API تنظیم نشده. از منوی 🗝️ توکن رو ثبت کن.");
      return;
    }
    if (mode === "token" && token && !isRadarTokenValidFormat(token)) {
      await logWarn("send_now_invalid_token_format", { tgUserId, mode });
      await ctx.reply("توکن/دسترسی نامعتبر. کد خطا: RADAR_401");
      return;
    }

    await ctx.reply("⏳ در حال آماده‌سازی چارت…");

    let radarData: RadarChartData;
    try {
      radarData = await fetchRadarData({ limit: 10 }, fetchConfig);
    } catch (error) {
      await logError(
        "send_now_radar_fetch_failed",
        {
          tgUserId,
          mode,
          dateRangePreset,
        },
        error
      );
      await ctx.reply(buildUserFacingError(error, mode));
      return;
    }

    let buffer: Buffer;
    try {
      buffer = await generateRadarChartPng(buildChartSeries(radarData), config.defaultTimezone);
    } catch (error) {
      await logError("send_now_chart_failed", { tgUserId, dateRangePreset }, error);
      await ctx.reply(buildUserFacingError(error, mode));
      return;
    }

    const caption = `Cloudflare Radar 🇮🇷\n${formatTimestamp(config.defaultTimezone)}`;
    try {
      await sendChartToChat(privateChatId, caption, buffer);
      if (shouldSendToTarget && selectedTarget) {
        await sendChartToChat(selectedTarget.chatId, caption, buffer);
      }
      state.lastSendByUserId.set(tgUserId, Date.now());
      state.lastRadarSourceByUserId.set(tgUserId, radarData.source);
      await ctx.reply("چارت ارسال شد ✅");
    } catch (error) {
      await logError("send_now_send_failed", { tgUserId }, error);
      await ctx.reply("ارسال چارت ناموفق بود. لطفاً دوباره امتحان کن.");
    }
    })();

    state.inFlightByUserId.set(tgUserId, task);
    try {
      await task;
    } finally {
      state.inFlightByUserId.delete(tgUserId);
    }
  };

  bot.command("diag_radar", async (ctx: Context) => {
    try {
      const tgUserId = ctx.from?.id ?? null;
      const user = tgUserId
        ? await prisma.user.findUnique({ where: { tgUserId: BigInt(tgUserId) } })
        : null;
      await runDiagnostics(ctx, user?.id);
    } catch (error) {
      await logError("radar_diag_failed", {}, error);
      await ctx.reply("اجرای تشخیص Radar ناموفق بود. دوباره تلاش کن.");
    }
  });

  bot.command("diag_scheduler", async (ctx: Context) => {
    try {
      const schedules = await prisma.targetSchedule.findMany({
        where: { targetChat: { isEnabled: true } },
        include: { targetChat: true },
        orderBy: { updatedAt: "asc" },
      });

      if (!schedules.length) {
        await ctx.reply("هیچ مقصد فعالی ثبت نشده است.");
        return;
      }

      const lines = [
        `تعداد مقصدهای فعال: ${schedules.length}`,
        ...schedules.map((schedule) =>
          [
            `- ${schedule.targetChat.title ?? "بدون عنوان"}`,
            `intervalMinutes=${schedule.intervalMinutes}`,
            `lastSentAt=${schedule.lastSentAt?.toISOString() ?? "-"}`,
            `nextRetryAt=${schedule.nextRetryAt?.toISOString() ?? "-"}`,
            `failCount=${schedule.failCount ?? 0}`,
          ].join(" ")
        ),
      ];

      await ctx.reply(lines.join("\n"));
    } catch (error) {
      await logError("diag_scheduler_failed", {}, error);
      await ctx.reply("اجرای تشخیص Scheduler ناموفق بود. دوباره تلاش کن.");
    }
  });

  registerMenuHandlers(bot, { prisma, sendNow, runDiagnostics });

  void logInfo("bot_initialized", { hasPublicUrl: Boolean(config.publicUrl) });

  return { bot, sendChartToChat };
};
