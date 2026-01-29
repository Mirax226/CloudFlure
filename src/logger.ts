import { loadConfig, type LogLevel, type PathApplierConfig } from "./config.js";

type LogMeta = Record<string, unknown>;

type LogPayload = {
  project: string;
  level: LogLevel;
  message: string;
  meta: LogMeta;
  timestamp: string;
};

let cachedConfig: PathApplierConfig | null = null;

const getPathApplierConfig = (): PathApplierConfig => {
  if (!cachedConfig) {
    cachedConfig = loadConfig().pathApplier;
  }
  return cachedConfig;
};

const requirePathApplierConfigValue = (value: string, message: string): void => {
  if (!value.trim()) {
    console.error(message);
    throw new Error(message);
  }
};

const validatePathApplierConfig = (config: PathApplierConfig): void => {
  requirePathApplierConfigValue(config.url, "Path-Applier URL not configured");
  requirePathApplierConfigValue(config.token, "Path-Applier token not configured");
  requirePathApplierConfigValue(config.projectName, "Project name not configured");
};

const formatErrorDetails = (error: unknown): LogMeta => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { message: String(error) };
};

const buildPayload = (
  config: PathApplierConfig,
  level: LogLevel,
  message: string,
  meta: LogMeta = {}
): LogPayload => ({
  project: config.projectName,
  level,
  message,
  meta,
  timestamp: new Date().toISOString(),
});

const sendToPathApplier = async (
  config: PathApplierConfig,
  payload: LogPayload
): Promise<void> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    console.log("path_applier_log_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timeoutId);
  }
};

const stringifyMetaValue = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return value.message;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const formatLogOutput = (
  config: PathApplierConfig,
  level: LogLevel,
  message: string,
  meta: LogMeta
): string => {
  const header = `[${config.projectName.toUpperCase()}][${level.toUpperCase()}]`;
  const metaEntries = Object.entries(meta);
  const metaLines =
    metaEntries.length === 0
      ? ["Meta:", "- (none)"]
      : ["Meta:", ...metaEntries.map(([key, value]) => `- ${key}: ${stringifyMetaValue(value)}`)];
  return [header, `Message: ${message}`, ...metaLines].join("\n");
};

const normalizeMeta = (meta?: unknown): LogMeta => {
  if (!meta) {
    return {};
  }
  if (meta instanceof Error) {
    return { error: formatErrorDetails(meta) };
  }
  if (typeof meta === "object" && !Array.isArray(meta)) {
    const record = meta as LogMeta;
    if (record.error instanceof Error) {
      return { ...record, error: formatErrorDetails(record.error) };
    }
    return record;
  }
  return { meta };
};

export const logInfo = async (message: string, meta?: LogMeta): Promise<void> => {
  const config = getPathApplierConfig();
  validatePathApplierConfig(config);
  const payloadMeta = normalizeMeta(meta);
  console.log(formatLogOutput(config, "info", message, payloadMeta));

  await sendToPathApplier(config, buildPayload(config, "info", message, payloadMeta));
};

export const logWarn = async (message: string, meta?: LogMeta): Promise<void> => {
  const config = getPathApplierConfig();
  validatePathApplierConfig(config);
  const payloadMeta = normalizeMeta(meta);
  console.warn(formatLogOutput(config, "warn", message, payloadMeta));

  await sendToPathApplier(config, buildPayload(config, "warn", message, payloadMeta));
};

export const logError = async (message: string, meta?: unknown): Promise<void> => {
  const config = getPathApplierConfig();
  validatePathApplierConfig(config);
  const payloadMeta = normalizeMeta(meta);
  console.error(formatLogOutput(config, "error", message, payloadMeta));

  await sendToPathApplier(config, buildPayload(config, "error", message, payloadMeta));
};

export const sendPingTest = async (): Promise<void> => {
  const config = getPathApplierConfig();
  validatePathApplierConfig(config);
  const message = "Ping test from Project X";
  await logInfo(message);
};
