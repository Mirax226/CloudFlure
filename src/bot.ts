import { Bot, InputFile, session } from "grammy";
import type { Context } from "grammy";
import type { PrismaClient } from "@prisma/client";
import type { EnvConfig } from "./config.js";
import { captureRadarChart } from "./screenshot/capture.js";
import { registerMenuHandlers, type SessionData } from "./ui/menus.js";

export type BotState = {
  lastAdminSendAt: number | null;
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
      initial: (): SessionData => ({ step: null, tempHour: null }),
    })
  );

  const sendChartToTargets = async (
    userChatId: bigint,
    caption: string,
    buffer: Buffer
  ) => {
    const channelPhoto = new InputFile(buffer, "radar.png");
    const userPhoto = new InputFile(buffer, "radar.png");
    await bot.api.sendPhoto(config.channelChatId, channelPhoto, { caption });
    await bot.api.sendPhoto(Number(userChatId), userPhoto, { caption });
  };

  const sendChartToChannel = async (caption: string, buffer: Buffer) => {
    const photo = new InputFile(buffer, "radar.png");
    await bot.api.sendPhoto(config.channelChatId, photo, { caption });
  };

  const sendNow = async (ctx: Context) => {
    const now = Date.now();
    if (state.lastAdminSendAt && now - state.lastAdminSendAt < config.screenshotCooldownSec * 1000) {
      await ctx.reply("کمی صبر کن تا دوباره ارسال کنیم ⏳");
      return;
    }

    state.lastAdminSendAt = now;
    if (!ctx.chat?.id) {
      await ctx.reply("چت نامعتبره، دوباره تلاش کن.");
      return;
    }
    const buffer = await captureRadarChart();
    const caption = `Cloudflare Radar 🇮🇷\n${formatTimestamp(config.defaultTimezone)}`;
    await sendChartToTargets(BigInt(ctx.chat.id), caption, buffer);
    await ctx.reply("چارت ارسال شد ✅");
  };

  registerMenuHandlers(bot, { prisma, config, sendNow });

  return { bot, sendChartToTargets, sendChartToChannel };
};
