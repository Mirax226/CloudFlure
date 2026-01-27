import dotenv from "dotenv";

dotenv.config();

type EnvConfig = {
  botToken: string;
  publicBaseUrl: string;
  databaseUrl: string;
  defaultTimezone: string;
  sendOnDeploy: boolean;
  screenshotCooldownSec: number;
  maxSendsPerTick: number;
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
  const databaseUrl = requireEnv("DATABASE_URL");
  const defaultTimezone = process.env.DEFAULT_TIMEZONE ?? "Asia/Baku";
  const sendOnDeploy = parseBoolean(process.env.SEND_ON_DEPLOY ?? "false");
  const screenshotCooldownSec = parseNumber(
    process.env.SCREENSHOT_COOLDOWN_SEC ?? "30",
    "SCREENSHOT_COOLDOWN_SEC"
  );
  const maxSendsPerTick = parseNumber(
    process.env.MAX_SENDS_PER_TICK ?? "20",
    "MAX_SENDS_PER_TICK"
  );

  return {
    botToken,
    publicBaseUrl,
    databaseUrl,
    defaultTimezone,
    sendOnDeploy,
    screenshotCooldownSec,
    maxSendsPerTick,
  };
};

export type { EnvConfig };
