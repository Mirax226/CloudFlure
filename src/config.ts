import dotenv from "dotenv";

dotenv.config();

type EnvConfig = {
  botToken: string;
  publicUrl: string;
  defaultTimezone: string;
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

export const loadConfig = (): EnvConfig => {
  const botToken = requireEnv("BOT_TOKEN");
  const publicUrl = requireEnv("PUBLIC_URL");
  requireEnv("DATABASE_URL");
  const defaultTimezone = "Asia/Baku";
  const screenshotCooldownSec = parseNumber("30", "SCREENSHOT_COOLDOWN_SEC");
  const maxSendsPerTick = parseNumber("20", "MAX_SENDS_PER_TICK");

  return {
    botToken,
    publicUrl,
    defaultTimezone,
    screenshotCooldownSec,
    maxSendsPerTick,
  };
};

export type { EnvConfig };
