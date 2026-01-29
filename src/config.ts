import dotenv from "dotenv";

dotenv.config();

type EnvConfig = {
  botToken: string;
  publicBaseUrl: string;
  databaseUrl: string;
  defaultTimezone: string;
  screenshotCooldownSec: number;
  maxSendsPerTick: number;
  pathApplier: PathApplierConfig;
};

type LogLevel = "info" | "warn" | "error";

type PathApplierConfig = {
  enabled: boolean;
  url: string;
  token: string;
  projectName: string;
  logLevel: LogLevel;
  pingEnabled: boolean;
};

const requireEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
};

const requirePathApplierEnv = (key: string, message: string): string => {
  const value = process.env[key]?.trim();
  if (!value) {
    console.error(message);
    throw new Error(message);
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

const parseLogLevel = (value: string | undefined): LogLevel => {
  if (value === "error" || value === "warn" || value === "info") {
    return value;
  }
  return "info";
};

export const loadConfig = (): EnvConfig => {
  const botToken = requireEnv("BOT_TOKEN");
  const publicBaseUrl = requireEnv("PUBLIC_BASE_URL");
  const databaseUrl = requireEnv("DATABASE_URL");
  const defaultTimezone = process.env.DEFAULT_TIMEZONE ?? "Asia/Baku";
  const screenshotCooldownSec = parseNumber(
    process.env.SCREENSHOT_COOLDOWN_SEC ?? "30",
    "SCREENSHOT_COOLDOWN_SEC"
  );
  const maxSendsPerTick = parseNumber(
    process.env.MAX_SENDS_PER_TICK ?? "20",
    "MAX_SENDS_PER_TICK"
  );
  const pathApplierUrl = requirePathApplierEnv(
    "PATH_APPLIER_URL",
    "Path-Applier URL not configured"
  );
  const pathApplierToken = requirePathApplierEnv(
    "PATH_APPLIER_TOKEN",
    "Path-Applier token not configured"
  );
  const pathApplierProjectName = requirePathApplierEnv(
    "PROJECT_NAME",
    "Project name not configured"
  );
  const pathApplierLogLevel = parseLogLevel(process.env.LOG_LEVEL);
  const pathApplierEnabled = true;
  const pathApplierPingEnabled = process.env.PATH_APPLIER_PING === "true";

  return {
    botToken,
    publicBaseUrl,
    databaseUrl,
    defaultTimezone,
    screenshotCooldownSec,
    maxSendsPerTick,
    pathApplier: {
      enabled: pathApplierEnabled,
      url: pathApplierUrl,
      token: pathApplierToken,
      projectName: pathApplierProjectName,
      logLevel: pathApplierLogLevel,
      pingEnabled: pathApplierPingEnabled,
    },
  };
};

export type { EnvConfig, LogLevel, PathApplierConfig };
