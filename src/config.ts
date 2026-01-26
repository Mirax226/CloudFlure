import dotenv from "dotenv";

dotenv.config();

type EnvConfig = {
  botToken: string;
  publicBaseUrl: string;
  webhookSecret: string;
  databaseUrl: string;
  channelChatId: number;
  adminUserIds: number[];
  defaultTimezone: string;
  sendOnDeploy: boolean;
  screenshotCooldownSec: number;
};

const requireEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
};

const parseNumber = (value: string, key: string): number => {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid number for env var ${key}: ${value}`);
  }
  return parsed;
};

const parseBoolean = (value: string): boolean => {
  return value.toLowerCase() === "true";
};

export const loadConfig = (): EnvConfig => {
  const botToken = requireEnv("BOT_TOKEN");
  const publicBaseUrl = requireEnv("PUBLIC_BASE_URL");
  const webhookSecret = requireEnv("WEBHOOK_SECRET");
  const databaseUrl = requireEnv("DATABASE_URL");
  const channelChatId = parseNumber(requireEnv("CHANNEL_CHAT_ID"), "CHANNEL_CHAT_ID");
  const adminUserIds = requireEnv("ADMIN_USER_IDS")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => parseNumber(id, "ADMIN_USER_IDS"));
  const defaultTimezone = process.env.DEFAULT_TIMEZONE ?? "Asia/Baku";
  const sendOnDeploy = parseBoolean(process.env.SEND_ON_DEPLOY ?? "false");
  const screenshotCooldownSec = parseNumber(
    process.env.SCREENSHOT_COOLDOWN_SEC ?? "30",
    "SCREENSHOT_COOLDOWN_SEC"
  );

  return {
    botToken,
    publicBaseUrl,
    webhookSecret,
    databaseUrl,
    channelChatId,
    adminUserIds,
    defaultTimezone,
    sendOnDeploy,
    screenshotCooldownSec,
  };
};

export type { EnvConfig };
