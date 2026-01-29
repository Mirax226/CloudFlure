import { Bot, InputFile, session } from "grammy";
import type { Context } from "grammy";
import type { PrismaClient } from "@prisma/client";
import type { EnvConfig } from "./config.js";
import { captureRadarChart } from "./screenshot/capture.js";
import { registerMenuHandlers, type SessionData } from "./ui/menus.js";

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

    let buffer: Buffer;
    try {
      buffer = await captureRadarChart();
    } catch (error) {
      console.warn("send_now_capture_failed", {
        tgUserId,
        error: error instanceof Error ? error.message : error,
      });
      await ctx.reply("⏳ الان رادار دیر لود شد. لطفاً دوباره امتحان کن.");
      return;
    }
    state.lastSendByUserId.set(tgUserId, now);
    const caption = `Cloudflare Radar 🇮🇷\n${formatTimestamp(config.defaultTimezone)}`;
    await sendChartToChat(privateChatId, caption, buffer);
    if (shouldSendToTarget && selectedTarget) {
      await sendChartToChat(selectedTarget.chatId, caption, buffer);
    }
    await ctx.reply("چارت ارسال شد ✅");
  };

  registerMenuHandlers(bot, { prisma, sendNow });

  return { bot, sendChartToChat };
};
