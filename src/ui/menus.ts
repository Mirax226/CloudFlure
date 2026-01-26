import type { Bot, Context } from "grammy";
import type { PrismaClient } from "@prisma/client";
import type { EnvConfig } from "../config.js";
import { labels, buildMainKeyboard } from "./keyboards.js";
import { isAdmin } from "../auth/admin.js";

export type SessionData = {
  step?: "hour" | "minute" | null;
  tempHour?: number | null;
};

type BotContext = Context & { session: SessionData };

type MenuDeps = {
  prisma: PrismaClient;
  config: EnvConfig;
  sendNow: (ctx: Context) => Promise<void>;
};

const ensureUser = async (ctx: Context, prisma: PrismaClient) => {
  const tgUserId = ctx.from?.id;
  const tgChatId = ctx.chat?.id;
  if (!tgUserId || !tgChatId) {
    return null;
  }
  return prisma.user.upsert({
    where: { tgUserId: BigInt(tgUserId) },
    update: { tgChatId: BigInt(tgChatId) },
    create: { tgUserId: BigInt(tgUserId), tgChatId: BigInt(tgChatId) },
  });
};

const formatTime = (hour?: number | null, minute?: number | null): string => {
  if (hour === null || hour === undefined || minute === null || minute === undefined) {
    return "تنظیم نشده";
  }
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return `${hh}:${mm}`;
};

const parseHour = (value: string): number | null => {
  const hour = Number(value);
  if (Number.isNaN(hour) || hour < 0 || hour > 23) {
    return null;
  }
  return hour;
};

const parseMinute = (value: string): number | null => {
  const minute = Number(value);
  if (Number.isNaN(minute) || minute < 0 || minute > 59) {
    return null;
  }
  return minute;
};

const parseTime = (value: string): { hour: number; minute: number } | null => {
  const match = value.trim().match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) {
    return null;
  }
  const hour = parseHour(match[1]);
  const minute = parseMinute(match[2]);
  if (hour === null || minute === null) {
    return null;
  }
  return { hour, minute };
};

const setUserTime = async (ctx: Context, prisma: PrismaClient, hour: number, minute: number) => {
  const tgUserId = ctx.from?.id;
  if (!tgUserId) {
    return;
  }
  await prisma.user.update({
    where: { tgUserId: BigInt(tgUserId) },
    data: { sendHour: hour, sendMinute: minute },
  });
};

const showStatus = async (ctx: Context, prisma: PrismaClient, config: EnvConfig) => {
  const tgUserId = ctx.from?.id;
  if (!tgUserId) {
    return;
  }
  const user = await prisma.user.findUnique({
    where: { tgUserId: BigInt(tgUserId) },
  });
  const isActive = user?.isActive ?? false;
  const time = formatTime(user?.sendHour, user?.sendMinute);
  const lastSent = "ثبت نشده";
  await ctx.reply(
    `وضعیت: ${isActive ? "فعال ✅" : "غیرفعال ⛔"}\nزمان ارسال: ${time}\nآخرین ارسال: ${lastSent}`,
    { reply_markup: buildMainKeyboard(isAdmin(ctx, config)) }
  );
};

const showHelp = async (ctx: Context, config: EnvConfig) => {
  await ctx.reply(
    [
      "برای تنظیم زمان ارسال از دکمه ⏱ استفاده کنید.",
      "فعال‌سازی فقط بعد از تنظیم زمان ممکن است.",
      `زمان نمایش بر اساس ${config.defaultTimezone} است.`,
    ].join("\n"),
    { reply_markup: buildMainKeyboard(isAdmin(ctx, config)) }
  );
};

export const registerMenuHandlers = (
  bot: Bot<BotContext>,
  { prisma, config, sendNow }: MenuDeps
) => {
  bot.command("start", async (ctx: BotContext) => {
    await ensureUser(ctx, prisma);
    await ctx.reply("خوش اومدی! یکی از گزینه‌های زیر رو انتخاب کن:", {
      reply_markup: buildMainKeyboard(isAdmin(ctx, config)),
    });
  });

  bot.hears(labels.status, async (ctx: BotContext) => {
    await ensureUser(ctx, prisma);
    await showStatus(ctx, prisma, config);
  });

  bot.hears(labels.setTime, async (ctx: BotContext) => {
    await ensureUser(ctx, prisma);
    ctx.session.step = "hour";
    ctx.session.tempHour = null;
    await ctx.reply("ساعت رو بفرست (0 تا 23) ⌚", {
      reply_markup: buildMainKeyboard(isAdmin(ctx, config)),
    });
  });

  bot.hears(labels.activate, async (ctx: BotContext) => {
    await ensureUser(ctx, prisma);
    const tgUserId = ctx.from?.id;
    if (!tgUserId) {
      return;
    }
    const user = await prisma.user.findUnique({
      where: { tgUserId: BigInt(tgUserId) },
    });
    if (user?.sendHour === null || user?.sendHour === undefined || user?.sendMinute === null || user?.sendMinute === undefined) {
      await ctx.reply("اول زمان ارسال رو تنظیم کن ⏱", {
        reply_markup: buildMainKeyboard(isAdmin(ctx, config)),
      });
      return;
    }
    await prisma.user.update({
      where: { tgUserId: BigInt(tgUserId) },
      data: { isActive: true },
    });
    await ctx.reply("ارسال خودکار فعال شد ✅", {
      reply_markup: buildMainKeyboard(isAdmin(ctx, config)),
    });
  });

  bot.hears(labels.deactivate, async (ctx: BotContext) => {
    await ensureUser(ctx, prisma);
    const tgUserId = ctx.from?.id;
    if (!tgUserId) {
      return;
    }
    await prisma.user.update({
      where: { tgUserId: BigInt(tgUserId) },
      data: { isActive: false },
    });
    await ctx.reply("ارسال خودکار غیرفعال شد ⛔", {
      reply_markup: buildMainKeyboard(isAdmin(ctx, config)) }
    );
  });

  bot.hears(labels.help, async (ctx: BotContext) => {
    await ensureUser(ctx, prisma);
    await showHelp(ctx, config);
  });

  bot.hears(labels.adminSendNow, async (ctx: BotContext) => {
    await ensureUser(ctx, prisma);
    if (!isAdmin(ctx, config)) {
      await ctx.reply("این بخش فقط برای ادمینه 🔒", {
        reply_markup: buildMainKeyboard(false),
      });
      return;
    }
    await sendNow(ctx);
  });

  bot.on("message:text", async (ctx: BotContext) => {
    await ensureUser(ctx, prisma);
    const text = ctx.message.text.trim();
    const quickTime = parseTime(text);
    if (quickTime) {
      await setUserTime(ctx, prisma, quickTime.hour, quickTime.minute);
      ctx.session.step = null;
      ctx.session.tempHour = null;
      await ctx.reply(`زمان شما شد ${formatTime(quickTime.hour, quickTime.minute)} ✅`, {
        reply_markup: buildMainKeyboard(isAdmin(ctx, config)),
      });
      return;
    }

    if (ctx.session.step === "hour") {
      const hour = parseHour(text);
      if (hour === null) {
        await ctx.reply("عدد نامعتبره. ساعت باید بین 0 تا 23 باشه ⌚");
        return;
      }
      ctx.session.tempHour = hour;
      ctx.session.step = "minute";
      await ctx.reply("دقیقه رو بفرست (0 تا 59) ⏰");
      return;
    }

    if (ctx.session.step === "minute") {
      const minute = parseMinute(text);
      if (minute === null) {
        await ctx.reply("عدد نامعتبره. دقیقه باید بین 0 تا 59 باشه ⏰");
        return;
      }
      const hour = ctx.session.tempHour ?? 0;
      await setUserTime(ctx, prisma, hour, minute);
      ctx.session.step = null;
      ctx.session.tempHour = null;
      await ctx.reply(`زمان شما شد ${formatTime(hour, minute)} ✅`, {
        reply_markup: buildMainKeyboard(isAdmin(ctx, config)),
      });
      return;
    }
  });
};
