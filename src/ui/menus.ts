import type { Bot, Context } from "grammy";
import type { PrismaClient } from "@prisma/client";
import { TargetChatType } from "@prisma/client";
import { labels, buildMainKeyboard } from "./keyboards.js";
import { getRadarDateRange, getRadarMode, setRadarApiToken, setRadarDateRange, setRadarMode } from "../db/settings.js";
import { logError } from "../logger.js";
import type { RadarMode } from "../radar/fetch.js";
import type { RadarDateRangePreset } from "../radar/dateRange.js";
import { isRadarTokenValidFormat } from "../radar/client.js";

export type SessionData = {
  step?:
    | "awaitingTargetForward"
    | "awaitingTargetSelection"
    | "awaitingInterval"
    | "awaitingRadarToken"
    | "awaitingRadarMode"
    | "awaitingRadarDateRange"
    | null;
};

type BotContext = Context & { session: SessionData };

type MenuDeps = {
  prisma: PrismaClient;
  sendNow: (ctx: Context) => Promise<void>;
  runDiagnostics: (ctx: Context, userId?: number) => Promise<void>;
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

const parseRadarMode = (text: string): RadarMode | null => {
  const normalized = text.toLowerCase();
  if (normalized.includes("public") || normalized.includes("عمومی")) {
    return "public";
  }
  if (normalized.includes("token") || normalized.includes("توکن")) {
    return "token";
  }
  if (normalized.includes("auto") || normalized.includes("خودکار")) {
    return "auto";
  }
  return null;
};

const radarModeLabel = (mode: RadarMode | null): string => {
  switch (mode) {
    case "public":
      return "Public (بدون توکن)";
    case "token":
      return "Token";
    case "auto":
      return "Auto";
    default:
      return "پیش‌فرض (Auto)";
  }
};

const RADAR_DATE_RANGE_OPTIONS: Array<{ preset: RadarDateRangePreset; label: string }> = [
  { preset: "D1", label: "1 روزه" },
  { preset: "D2", label: "2 روزه" },
  { preset: "D3", label: "3 روزه" },
  { preset: "D7", label: "1 هفته" },
  { preset: "D14", label: "2 هفته" },
  { preset: "D21", label: "3 هفته" },
  { preset: "M1", label: "1 ماه" },
  { preset: "M2", label: "2 ماه" },
  { preset: "M3", label: "3 ماه" },
  { preset: "Y1", label: "1 سال" },
];

const radarDateRangeLabel = (preset: RadarDateRangePreset | null): string => {
  const option = RADAR_DATE_RANGE_OPTIONS.find((item) => item.preset === preset);
  return option?.label ?? "1 هفته";
};

const parseRadarDateRange = (text: string): RadarDateRangePreset | null => {
  const trimmed = text.trim();
  const option = RADAR_DATE_RANGE_OPTIONS.find((item) => trimmed.includes(item.label));
  return option?.preset ?? null;
};

const showHelp = async (ctx: Context) => {
  await ctx.reply(
    [
      "برای افزودن مقصد، روی ➕ بزن و از کانال/گروه برام پیام فوروارد کن 📩",
      "برای تنظیم بازه ارسال باید اول مقصد رو انتخاب کنی 🎯",
      "بعد از انتخاب مقصد، بازه رو با عدد دقیقه یا فرمت 2h/45m ارسال کن ⏱",
      "برای دریافت دیتا، توکن Radar API یا حالت Public/Auto رو تنظیم کن 🧭",
    ].join("\n"),
    { reply_markup: buildMainKeyboard() }
  );
};

const safeHandler = <T extends Context>(handler: (ctx: T) => Promise<void>) => {
  return async (ctx: T) => {
    try {
      await handler(ctx);
    } catch (error) {
      await logError("menu_handler_failed", { updateId: ctx.update.update_id }, error);
      try {
        await ctx.reply("خطای غیرمنتظره‌ای رخ داد. لطفاً دوباره تلاش کن.", {
          reply_markup: buildMainKeyboard(),
        });
      } catch {
        // Ignore reply errors
      }
    }
  };
};

export const registerMenuHandlers = (bot: Bot<BotContext>, { prisma, sendNow, runDiagnostics }: MenuDeps) => {
  bot.command(
    "start",
    safeHandler(async (ctx: BotContext) => {
      await ensureUser(ctx, prisma);
      console.log("telegram_start_received", { userId: ctx.from?.id });
      ctx.session.step = null;
      await ctx.reply("خوش اومدی! یکی از گزینه‌های زیر رو انتخاب کن:", {
        reply_markup: buildMainKeyboard(),
      });
    })
  );

  bot.hears(
    labels.sendNow,
    safeHandler(async (ctx: BotContext) => {
      await ensureUser(ctx, prisma);
      ctx.session.step = null;
      await sendNow(ctx);
    })
  );

  bot.hears(
    labels.addTarget,
    safeHandler(async (ctx: BotContext) => {
      await ensureUser(ctx, prisma);
      ctx.session.step = "awaitingTargetForward";
      await ctx.reply("بات رو به کانال/گروه اضافه کن و یک پیام از همونجا برام Forward کن 📩", {
        reply_markup: buildMainKeyboard(),
      });
    })
  );

  bot.hears(
    labels.listTargets,
    safeHandler(async (ctx: BotContext) => {
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
    })
  );

  bot.hears(
    labels.selectTarget,
    safeHandler(async (ctx: BotContext) => {
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
    })
  );

  bot.hears(
    labels.setInterval,
    safeHandler(async (ctx: BotContext) => {
      const user = await ensureUser(ctx, prisma);
      if (!user?.selectedTargetId) {
        await ctx.reply("اول مقصد رو انتخاب کن 🎯", {
          reply_markup: buildMainKeyboard(),
        });
        return;
      }
      ctx.session.step = "awaitingInterval";
      await ctx.reply("بازه ارسال رو بفرست (حداقل 3 دقیقه؛ مثلاً 15 یا 2h یا 45m) ⏱", {
        reply_markup: buildMainKeyboard(),
      });
    })
  );

  bot.hears(
    labels.toggleTarget,
    safeHandler(async (ctx: BotContext) => {
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
      await ctx.reply(`وضعیت مقصد شد: ${updated.isEnabled ? "فعال ✅" : "غیرفعال ⛔"}`, {
        reply_markup: buildMainKeyboard(),
      });
    })
  );

  bot.hears(
    labels.setRadarToken,
    safeHandler(async (ctx: BotContext) => {
      await ensureUser(ctx, prisma);
      ctx.session.step = "awaitingRadarToken";
      await ctx.reply("توکن Radar API رو ارسال کن 🗝️", {
        reply_markup: buildMainKeyboard(),
      });
    })
  );

  bot.hears(
    labels.setRadarSource,
    safeHandler(async (ctx: BotContext) => {
      const user = await ensureUser(ctx, prisma);
      if (!user) {
        return;
      }
      const currentMode = await getRadarMode(prisma, user.id);
      ctx.session.step = "awaitingRadarMode";
      await ctx.reply(
        [
          `حالت فعلی: ${radarModeLabel(currentMode)}`,
          "یکی از گزینه‌ها رو بفرست:",
          "- Public (بدون توکن)",
          "- Token",
          "- Auto",
        ].join("\n"),
        { reply_markup: buildMainKeyboard() }
      );
    })
  );

  bot.hears(
    labels.setRadarDateRange,
    safeHandler(async (ctx: BotContext) => {
      const user = await ensureUser(ctx, prisma);
      if (!user) {
        return;
      }
      const currentRange = await getRadarDateRange(prisma, user.id);
      ctx.session.step = "awaitingRadarDateRange";
      await ctx.reply(
        [
          `بازه فعلی: ${radarDateRangeLabel(currentRange)}`,
          "یکی از گزینه‌ها رو بفرست:",
          ...RADAR_DATE_RANGE_OPTIONS.map((option) => `- ${option.label}`),
        ].join("\n"),
        { reply_markup: buildMainKeyboard() }
      );
    })
  );

  bot.hears(
    labels.help,
    safeHandler(async (ctx: BotContext) => {
      await ensureUser(ctx, prisma);
      ctx.session.step = null;
      await showHelp(ctx);
    })
  );

  bot.on(
    "message",
    safeHandler(async (ctx: BotContext) => {
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
        await ctx.reply(`✅ مقصد اضافه شد: ${target.title ?? "بدون عنوان"} — هر 60 دقیقه`, {
          reply_markup: buildMainKeyboard(),
        });
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
        await ctx.reply(`🎯 مقصد انتخاب شد: ${target.title ?? "بدون عنوان"}`,
          {
            reply_markup: buildMainKeyboard(),
          }
        );
        return;
      }

      if (ctx.session.step === "awaitingInterval") {
        const minutes = parseIntervalMinutes(text);
        if (!minutes || minutes < 3 || minutes > 1440) {
          await ctx.reply("عدد نامعتبره. بازه باید بین 3 تا 1440 دقیقه باشه.", {
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

      if (ctx.session.step === "awaitingRadarToken") {
        if (!isRadarTokenValidFormat(text)) {
          await ctx.reply("فرمت توکن معتبر نیست. یک توکن صحیح ارسال کن.", {
            reply_markup: buildMainKeyboard(),
          });
          return;
        }
        await setRadarApiToken(prisma, text, user.id);
        ctx.session.step = null;
        await ctx.reply("توکن Radar API ذخیره شد، در حال تست...", {
          reply_markup: buildMainKeyboard(),
        });
        await runDiagnostics(ctx, user.id);
        return;
      }

      if (ctx.session.step === "awaitingRadarMode") {
        const mode = parseRadarMode(text);
        if (!mode) {
          await ctx.reply("مقدار نامعتبره. یکی از Public / Token / Auto رو بفرست.", {
            reply_markup: buildMainKeyboard(),
          });
          return;
        }
        await setRadarMode(prisma, mode, user.id);
        ctx.session.step = null;
        await ctx.reply(`منبع دیتا شد: ${radarModeLabel(mode)} ✅`, {
          reply_markup: buildMainKeyboard(),
        });
        return;
      }

      if (ctx.session.step === "awaitingRadarDateRange") {
        const preset = parseRadarDateRange(text);
        if (!preset) {
          await ctx.reply("مقدار نامعتبره. یکی از گزینه‌های بازه زمانی رو بفرست.", {
            reply_markup: buildMainKeyboard(),
          });
          return;
        }
        await setRadarDateRange(prisma, preset, user.id);
        ctx.session.step = null;
        await ctx.reply(`بازه زمانی شد: ${radarDateRangeLabel(preset)} ✅`, {
          reply_markup: buildMainKeyboard(),
        });
      }
    })
  );
};
