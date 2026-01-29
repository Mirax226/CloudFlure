import { Bot, InputFile, session } from "grammy";
import type { Context } from "grammy";
import type { PrismaClient } from "@prisma/client";
import type { EnvConfig } from "./config.js";
import { generateRadarChartPng } from "./radar/generate.js";
import { registerMenuHandlers, type SessionData } from "./ui/menus.js";
import { logError } from "./logger.js";
import { getRadarApiToken } from "./db/settings.js";

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

    const radarToken = await getRadarApiToken(prisma);
    if (!radarToken) {
      await ctx.reply("اول از منو 🗝️ توکن Radar API رو تنظیم کن.");
      return;
    }

    const selectedTarget = user.selectedTargetId
      ? await prisma.targetChat.findUnique({ where: { id: user.selectedTargetId } })
      : null;
    const shouldSendToTarget = Boolean(selectedTarget?.isEnabled);

    await ctx.reply("⏳ در حال آماده‌سازی چارت…");

    void (async () => {
      let buffer: Buffer;
      try {
        buffer = await generateRadarChartPng(radarToken, config.defaultTimezone);
      } catch (error) {
        await logError("send_now_chart_failed", { tgUserId, error });
        await ctx.reply("چارت آماده نشد. لطفاً دوباره امتحان کن.");
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
    })();
  };

  registerMenuHandlers(bot, { prisma, sendNow });

  return { bot, sendChartToChat };
};
