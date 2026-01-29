import { loadConfig, type LogLevel, type PathApplierConfig } from "./config.js";

type LogMeta = Record<string, unknown>;

type LogPayload = {
  project: string;
  level: LogLevel;
  message: string;
  meta: LogMeta;
  timestamp: string;
};

const levelPriority: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
};

let cachedConfig: PathApplierConfig | null = null;

const getPathApplierConfig = (): PathApplierConfig => {
  if (!cachedConfig) {
    cachedConfig = loadConfig().pathApplier;
  }
  return cachedConfig;
};

const shouldSend = (level: LogLevel, config: PathApplierConfig): boolean => {
  return levelPriority[level] <= levelPriority[config.logLevel];
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
  if (!config.enabled) {
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    await fetch(`${config.url}/api/logs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    console.warn("path_applier_log_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timeoutId);
  }
};

export const logInfo = async (message: string, meta?: LogMeta): Promise<void> => {
  if (meta) {
    console.log(message, meta);
  } else {
    console.log(message);
  }

  const config = getPathApplierConfig();
  if (!shouldSend("info", config)) {
    return;
  }

  await sendToPathApplier(config, buildPayload(config, "info", message, meta ?? {}));
};

export const logWarn = async (message: string, meta?: LogMeta): Promise<void> => {
  if (meta) {
    console.warn(message, meta);
  } else {
    console.warn(message);
  }

  const config = getPathApplierConfig();
  if (!shouldSend("warn", config)) {
    return;
  }

  await sendToPathApplier(config, buildPayload(config, "warn", message, meta ?? {}));
};

export const logError = async (error: unknown, meta?: LogMeta): Promise<void> => {
  console.error(error, meta);

  const config = getPathApplierConfig();
  if (!shouldSend("error", config)) {
    return;
  }

  const errorDetails = formatErrorDetails(error);
  const message =
    typeof errorDetails.message === "string" ? errorDetails.message : "Unknown error";
  const payloadMeta = { ...meta, error: errorDetails };

  await sendToPathApplier(config, buildPayload(config, "error", message, payloadMeta));
};

export const sendPingTest = async (): Promise<void> => {
  const config = getPathApplierConfig();
  const message = "Ping test from Project X";
  console.log(message);

  const payload = buildPayload(config, "info", message, {});
  await sendToPathApplier(config, payload);
};
