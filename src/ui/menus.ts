import type { Bot, Context } from "grammy";
import type { PrismaClient } from "@prisma/client";
import { TargetChatType } from "@prisma/client";
import { labels, buildMainKeyboard } from "./keyboards.js";

export type SessionData = {
  step?: "awaitingTargetForward" | "awaitingTargetSelection" | "awaitingInterval" | null;
};

type BotContext = Context & { session: SessionData };

type MenuDeps = {
  prisma: PrismaClient;
  sendNow: (ctx: Context) => Promise<void>;
};

type ForwardedChat = {
  id: number;
  title?: string;
  type: string;
};

const ensureUser = async (ctx: Context, prisma: PrismaClient) => {
  const tgUserId = ctx.from?.id;
  if (!tgUserId) {
    return null;
  }
  const privateChatId = ctx.chat?.type === "private" ? ctx.chat.id : null;
  return prisma.user.upsert({
    where: { tgUserId: BigInt(tgUserId) },
    update: privateChatId ? { privateChatId: BigInt(privateChatId) } : {},
    create: {
      tgUserId: BigInt(tgUserId),
      privateChatId: privateChatId ? BigInt(privateChatId) : null,
    },
  });
};

const getUserTargets = async (userId: number, prisma: PrismaClient) => {
  return prisma.targetChat.findMany({
    where: { createdByUserId: userId },
    include: { schedule: true },
    orderBy: { createdAt: "asc" },
  });
};

const formatTargetLine = (index: number, target: Awaited<ReturnType<typeof getUserTargets>>[number]) => {
  const title = target.title ?? "بدون عنوان";
  const enabled = target.isEnabled ? "فعال ✅" : "غیرفعال ⛔";
  const interval = target.schedule?.intervalMinutes ?? 60;
  return `${index}. ${title} — ${enabled} — هر ${interval} دقیقه`;
};

const parseIntervalMinutes = (value: string): number | null => {
  const trimmed = value.trim().toLowerCase();
  const hourMatch = trimmed.match(/^(\d+)\s*h$/);
  if (hourMatch) {
    return Number(hourMatch[1]) * 60;
  }
  const minuteMatch = trimmed.match(/^(\d+)\s*m$/);
  if (minuteMatch) {
    return Number(minuteMatch[1]);
  }
  const numeric = Number(trimmed);
  if (Number.isNaN(numeric)) {
    return null;
  }
  return numeric;
};

const resolveTargetType = (chatType: string): TargetChatType | null => {
  switch (chatType) {
    case "channel":
      return TargetChatType.CHANNEL;
    case "group":
      return TargetChatType.GROUP;
    case "supergroup":
      return TargetChatType.SUPERGROUP;
    default:
      return null;
  }
};

const showHelp = async (ctx: Context) => {
  await ctx.reply(
    [
      "برای افزودن مقصد، روی ➕ بزن و از کانال/گروه برام پیام فوروارد کن 📩",
      "برای تنظیم بازه ارسال باید اول مقصد رو انتخاب کنی 🎯",
      "بعد از انتخاب مقصد، بازه رو با عدد دقیقه یا فرمت 2h/45m ارسال کن ⏱",
    ].join("\n"),
    { reply_markup: buildMainKeyboard() }
  );
};

export const registerMenuHandlers = (
  bot: Bot<BotContext>,
  { prisma, sendNow }: MenuDeps
) => {
  bot.command("start", async (ctx: BotContext) => {
    await ensureUser(ctx, prisma);
    ctx.session.step = null;
    await ctx.reply("خوش اومدی! یکی از گزینه‌های زیر رو انتخاب کن:", {
      reply_markup: buildMainKeyboard(),
    });
  });

  bot.hears(labels.sendNow, async (ctx: BotContext) => {
    await ensureUser(ctx, prisma);
    ctx.session.step = null;
    await sendNow(ctx);
  });

  bot.hears(labels.addTarget, async (ctx: BotContext) => {
    await ensureUser(ctx, prisma);
    ctx.session.step = "awaitingTargetForward";
    await ctx.reply(
      "بات رو به کانال/گروه اضافه کن و یک پیام از همونجا برام Forward کن 📩",
      { reply_markup: buildMainKeyboard() }
    );
  });

  bot.hears(labels.listTargets, async (ctx: BotContext) => {
    const user = await ensureUser(ctx, prisma);
    ctx.session.step = null;
    if (!user) {
      return;
    }
    const targets = await getUserTargets(user.id, prisma);
    if (!targets.length) {
      await ctx.reply("هنوز مقصدی اضافه نکردی. از دکمه ➕ استفاده کن.", {
        reply_markup: buildMainKeyboard(),
      });
      return;
    }
    const lines = targets.map((target, index) => formatTargetLine(index + 1, target));
    await ctx.reply(lines.join("\n"), { reply_markup: buildMainKeyboard() });
  });

  bot.hears(labels.selectTarget, async (ctx: BotContext) => {
    const user = await ensureUser(ctx, prisma);
    if (!user) {
      return;
    }
    const targets = await getUserTargets(user.id, prisma);
    if (!targets.length) {
      await ctx.reply("اول یک مقصد اضافه کن. از دکمه ➕ استفاده کن.", {
        reply_markup: buildMainKeyboard(),
      });
      return;
    }
    const lines = targets.map((target, index) => formatTargetLine(index + 1, target));
    await ctx.reply([lines.join("\n"), "شماره مقصد را ارسال کن 🎯"].join("\n"), {
      reply_markup: buildMainKeyboard(),
    });
    ctx.session.step = "awaitingTargetSelection";
  });

  bot.hears(labels.setInterval, async (ctx: BotContext) => {
    const user = await ensureUser(ctx, prisma);
    if (!user?.selectedTargetId) {
      await ctx.reply("اول مقصد رو انتخاب کن 🎯", {
        reply_markup: buildMainKeyboard(),
      });
      return;
    }
    ctx.session.step = "awaitingInterval";
    await ctx.reply("بازه ارسال رو بفرست (مثلاً 15 یا 2h یا 45m) ⏱", {
      reply_markup: buildMainKeyboard(),
    });
  });

  bot.hears(labels.toggleTarget, async (ctx: BotContext) => {
    const user = await ensureUser(ctx, prisma);
    ctx.session.step = null;
    if (!user?.selectedTargetId) {
      await ctx.reply("اول مقصد رو انتخاب کن 🎯", {
        reply_markup: buildMainKeyboard(),
      });
      return;
    }
    const target = await prisma.targetChat.findUnique({
      where: { id: user.selectedTargetId },
    });
    if (!target) {
      await ctx.reply("مقصد پیدا نشد. دوباره انتخاب کن.", {
        reply_markup: buildMainKeyboard(),
      });
      return;
    }
    const updated = await prisma.targetChat.update({
      where: { id: target.id },
      data: { isEnabled: !target.isEnabled },
    });
    await ctx.reply(
      `وضعیت مقصد شد: ${updated.isEnabled ? "فعال ✅" : "غیرفعال ⛔"}`,
      { reply_markup: buildMainKeyboard() }
    );
  });

  bot.hears(labels.help, async (ctx: BotContext) => {
    await ensureUser(ctx, prisma);
    ctx.session.step = null;
    await showHelp(ctx);
  });

  bot.on("message", async (ctx: BotContext) => {
    const user = await ensureUser(ctx, prisma);
    if (!user) {
      return;
    }

    const message = ctx.message;
    const forwardChat =
      message && "forward_from_chat" in message
        ? (message.forward_from_chat as ForwardedChat | undefined)
        : undefined;
    if (ctx.session.step === "awaitingTargetForward") {
      if (!forwardChat) {
        await ctx.reply("پیام فوروارد شده از کانال/گروه رو بفرست 📩", {
          reply_markup: buildMainKeyboard(),
        });
        return;
      }
      const targetType = resolveTargetType(forwardChat.type);
      if (!targetType) {
        await ctx.reply("نوع مقصد پشتیبانی نمی‌شه. دوباره تلاش کن.", {
          reply_markup: buildMainKeyboard(),
        });
        return;
      }
      const target = await prisma.targetChat.upsert({
        where: { chatId: BigInt(forwardChat.id) },
        update: {
          title: forwardChat.title ?? null,
          type: targetType,
        },
        create: {
          chatId: BigInt(forwardChat.id),
          title: forwardChat.title ?? null,
          type: targetType,
          createdByUserId: user.id,
        },
      });
      await prisma.targetSchedule.upsert({
        where: { targetChatId: target.id },
        update: {},
        create: {
          targetChatId: target.id,
          intervalMinutes: 60,
        },
      });
      ctx.session.step = null;
      await ctx.reply(
        `✅ مقصد اضافه شد: ${target.title ?? "بدون عنوان"} — هر 60 دقیقه`,
        { reply_markup: buildMainKeyboard() }
      );
      return;
    }

    const text = message?.text?.trim();
    if (!text) {
      return;
    }

    if (ctx.session.step === "awaitingTargetSelection") {
      const index = Number(text);
      if (Number.isNaN(index) || index < 1) {
        await ctx.reply("شماره نامعتبره. یک عدد معتبر بفرست.", {
          reply_markup: buildMainKeyboard(),
        });
        return;
      }
      const targets = await getUserTargets(user.id, prisma);
      const target = targets[index - 1];
      if (!target) {
        await ctx.reply("شماره مقصد پیدا نشد. دوباره تلاش کن.", {
          reply_markup: buildMainKeyboard(),
        });
        return;
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { selectedTargetId: target.id },
      });
      ctx.session.step = null;
      await ctx.reply(`🎯 مقصد انتخاب شد: ${target.title ?? "بدون عنوان"}`, {
        reply_markup: buildMainKeyboard(),
      });
      return;
    }

    if (ctx.session.step === "awaitingInterval") {
      const minutes = parseIntervalMinutes(text);
      if (!minutes || minutes < 1 || minutes > 1440) {
        await ctx.reply("عدد نامعتبره. بازه باید بین 1 تا 1440 دقیقه باشه.", {
          reply_markup: buildMainKeyboard(),
        });
        return;
      }
      if (!user.selectedTargetId) {
        await ctx.reply("اول مقصد رو انتخاب کن 🎯", {
          reply_markup: buildMainKeyboard(),
        });
        return;
      }
      await prisma.targetSchedule.upsert({
        where: { targetChatId: user.selectedTargetId },
        update: { intervalMinutes: minutes },
        create: { targetChatId: user.selectedTargetId, intervalMinutes: minutes },
      });
      ctx.session.step = null;
      await ctx.reply(`بازه ارسال شد ${minutes} دقیقه ✅`, {
        reply_markup: buildMainKeyboard(),
      });
      return;
    }
  });
};
