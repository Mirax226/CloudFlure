import { Bot, InputFile, session } from "grammy";
import type { Context } from "grammy";
import type { PrismaClient } from "@prisma/client";
import type { EnvConfig } from "./config.js";
import { generateRadarChartPng, ChartRenderError } from "./radar/generate.js";
import {
  fetchRadarData,
  RadarFetchError,
  type RadarFetchConfig,
  type RadarMode,
  type RadarTimeseriesPoint,
  testPublicRadarEndpoint,
  testTokenRadarEndpoint,
} from "./radar/fetch.js";
import { registerMenuHandlers, type SessionData } from "./ui/menus.js";
import { logError, logInfo } from "./logger.js";
import { getRadarSettings } from "./db/settings.js";

export type BotState = {
  lastSendByUserId: Map<number, number>;
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
  config: EnvConfig
): Promise<{ fetchConfig: RadarFetchConfig; mode: RadarMode; token: string | null }> => {
  const settings = await getRadarSettings(prisma);
  const mode = settings.radarMode ?? config.radar.mode;
  const token = settings.radarApiToken ?? config.radar.apiToken;
  return {
    mode,
    token,
    fetchConfig: {
      mode,
      token,
      publicBaseUrl: config.radar.publicBaseUrl,
      tokenBaseUrl: config.radar.tokenBaseUrl,
      timeoutMs: config.radar.httpTimeoutMs,
      retryMax: config.radar.retryMax,
      retryBaseDelayMs: config.radar.retryBaseDelayMs,
    },
  };
};

const buildUserFacingError = (error: unknown): string => {
  if (error instanceof RadarFetchError) {
    switch (error.code) {
      case "RADAR_UNAUTHORIZED":
        return "توکن معتبر نیست یا دسترسی نداره. توکن رو دوباره تنظیم کن.";
      case "RADAR_BAD_REQUEST":
        return "خطای تنظیمات درخواست (400). این مورد نیاز به اصلاح فنی داره.";
      case "RADAR_RATE_LIMIT":
        return "فعلاً درخواست‌ها زیاد شده. چند دقیقه دیگه دوباره امتحان کن.";
      case "RADAR_TIMEOUT":
        return "سرور دیر جواب داد. دوباره امتحان کن.";
      case "RADAR_UPSTREAM":
      case "RADAR_NETWORK":
        return "مشکل در دریافت دیتا از Radar. دوباره امتحان کن.";
      case "RADAR_INVALID_DATA":
        return "دیتای معتبر دریافت نشد. دوباره امتحان کن.";
      default:
        return "دریافت دیتا ناموفق بود. دوباره تلاش کن.";
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
      error: error.error,
    });
  });

  const sendChartToChat = async (chatId: bigint | number, caption: string, buffer: Buffer) => {
    const photo = new InputFile(buffer, "radar.png");
    await bot.api.sendPhoto(Number(chatId), photo, { caption });
  };

  const sendNow = async (ctx: Context) => {
    const tgUserId = ctx.from?.id;
    if (!tgUserId) {
      await ctx.reply("کاربر نامعتبره، دوباره تلاش کن.");
      return;
    }
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

    const { fetchConfig, mode, token } = await resolveRadarFetchConfig(prisma, config);
    if (mode === "token" && !token) {
      await ctx.reply("توکن Radar API تنظیم نشده. از منوی 🗝️ توکن رو ثبت کن.");
      return;
    }

    await ctx.reply("⏳ در حال آماده‌سازی چارت…");

    let points: RadarTimeseriesPoint[];
    try {
      const radarData = await fetchRadarData({ dateRange: "1d", location: "IR" }, fetchConfig);
      points = radarData.points;
    } catch (error) {
      await logError("send_now_radar_fetch_failed", { tgUserId, mode, error });
      await ctx.reply(buildUserFacingError(error));
      return;
    }

    let buffer: Buffer;
    try {
      buffer = await generateRadarChartPng(points, config.defaultTimezone);
    } catch (error) {
      await logError("send_now_chart_failed", { tgUserId, error });
      await ctx.reply(buildUserFacingError(error));
      return;
    }

    const caption = `Cloudflare Radar 🇮🇷\n${formatTimestamp(config.defaultTimezone)}`;
    try {
      await sendChartToChat(privateChatId, caption, buffer);
      if (shouldSendToTarget && selectedTarget) {
        await sendChartToChat(selectedTarget.chatId, caption, buffer);
      }
      state.lastSendByUserId.set(tgUserId, Date.now());
      await ctx.reply("چارت ارسال شد ✅");
    } catch (error) {
      await logError("send_now_send_failed", { tgUserId, error });
      await ctx.reply("ارسال چارت ناموفق بود. لطفاً دوباره امتحان کن.");
    }
  };

  bot.command("radar_test", async (ctx: Context) => {
    try {
      const { fetchConfig, token } = await resolveRadarFetchConfig(prisma, config);
      const publicResult = await testPublicRadarEndpoint({ ...fetchConfig, mode: "public" });
      const tokenResult = token
        ? await testTokenRadarEndpoint({ ...fetchConfig, mode: "token", token })
        : null;

      const lines = [
        `Public: ${publicResult.ok ? "✅" : `❌ (${publicResult.error ?? "error"})`}`,
        tokenResult
          ? `Token: ${tokenResult.ok ? "✅" : `❌ (${tokenResult.error ?? "error"})`}`
          : "Token: تنظیم نشده",
      ];

      await ctx.reply(lines.join("\n"));
    } catch (error) {
      await logError("radar_test_failed", { error });
      await ctx.reply("اجرای تست Radar ناموفق بود. دوباره تلاش کن.");
    }
  });

  registerMenuHandlers(bot, { prisma, sendNow });

  void logInfo("bot_initialized", { hasPublicUrl: Boolean(config.publicUrl) });

  return { bot, sendChartToChat };
};
