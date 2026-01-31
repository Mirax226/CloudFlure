import dotenv from "dotenv";

dotenv.config();

export type RadarMode = "public" | "token" | "auto";

type EnvConfig = {
  botToken: string;
  publicUrl: string | null;
  defaultTimezone: string;
  screenshotCooldownSec: number;
  maxSendsPerTick: number;
  radar: {
    mode: RadarMode;
    apiToken: string | null;
    publicBaseUrl: string;
    tokenBaseUrl: string;
    httpTimeoutMs: number;
    retryMax: number;
    retryBaseDelayMs: number;
  };
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

const parseNumberEnv = (key: string, defaultValue: number): number => {
  const raw = process.env[key];
  if (!raw) {
    return defaultValue;
  }
  return parseNumber(raw, key);
};

const parseRadarMode = (value: string | undefined): RadarMode => {
  if (!value) {
    return "auto";
  }
  const normalized = value.toLowerCase();
  if (normalized === "public" || normalized === "token" || normalized === "auto") {
    return normalized;
  }
  console.warn(`Invalid RADAR_MODE value: ${value}, falling back to auto`);
  return "auto";
};

export const loadConfig = (): EnvConfig => {
  const botToken = requireEnv("BOT_TOKEN");
  requireEnv("DATABASE_URL");
  const publicUrl = process.env.PUBLIC_URL ?? null;
  const defaultTimezone = "Asia/Baku";
  const screenshotCooldownSec = parseNumberEnv("SCREENSHOT_COOLDOWN_SEC", 30);
  const maxSendsPerTick = parseNumberEnv("MAX_SENDS_PER_TICK", 20);
  const radarMode = parseRadarMode(process.env.RADAR_MODE);
  const radarApiToken = process.env.RADAR_API_TOKEN ?? null;
  const radarPublicBaseUrl = process.env.RADAR_PUBLIC_BASE_URL ?? "https://api.cloudflare.com/client/v4/radar";
  const radarTokenBaseUrl = process.env.RADAR_TOKEN_BASE_URL ?? "https://api.cloudflare.com/client/v4/radar";
  const radarHttpTimeoutMs = parseNumberEnv("RADAR_HTTP_TIMEOUT_MS", 15_000);
  const radarRetryMax = parseNumberEnv("RADAR_RETRY_MAX", 2);
  const radarRetryBaseDelayMs = parseNumberEnv("RADAR_RETRY_BASE_DELAY_MS", 500);

  return {
    botToken,
    publicUrl,
    defaultTimezone,
    screenshotCooldownSec,
    maxSendsPerTick,
    radar: {
      mode: radarMode,
      apiToken: radarApiToken,
      publicBaseUrl: radarPublicBaseUrl,
      tokenBaseUrl: radarTokenBaseUrl,
      httpTimeoutMs: radarHttpTimeoutMs,
      retryMax: radarRetryMax,
      retryBaseDelayMs: radarRetryBaseDelayMs,
    },
  };
};

export type { EnvConfig };
