import { reportToPM, getPmDisabledReason, type PMLevel } from "./pmReporter.js";

type LogLevel = "info" | "warn" | "error";

type LogMeta = Record<string, unknown>;

const DROP_META_KEYS = new Set(["config", "request", "response", "raw", "rawConfig"]);
const REDACT_KEY_PATTERN = /(token|authorization|api[_-]?token|path[_-]?applier|secret|password)/i;

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

const redactValue = (value: unknown, depth = 0): unknown => {
  if (value == null) {
    return value;
  }
  if (typeof value === "string") {
    if (value.startsWith("Bearer ")) {
      return "[redacted]";
    }
    return value;
  }
  if (value instanceof Error) {
    return formatErrorDetails(value);
  }
  if (Array.isArray(value)) {
    if (depth > 2) {
      return value.slice(0, 5);
    }
    return value.map((item) => redactValue(item, depth + 1));
  }
  if (typeof value === "object") {
    if (depth > 2) {
      return "[truncated]";
    }
    const record = value as Record<string, unknown>;
    const entries = Object.entries(record).flatMap(([key, entry]) => {
      if (DROP_META_KEYS.has(key)) {
        return [];
      }
      if (REDACT_KEY_PATTERN.test(key)) {
        return [[key, "[redacted]"]];
      }
      return [[key, redactValue(entry, depth + 1)]];
    });
    return Object.fromEntries(entries);
  }
  return value;
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

const formatLogOutput = (level: LogLevel, message: string, meta: LogMeta): string => {
  const header = `[LOG][${level.toUpperCase()}]`;
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

const enrichMeta = (meta: LogMeta): LogMeta => {
  const pmDisabledReason = getPmDisabledReason();
  const baseMeta: LogMeta = {
    renderService: process.env.RENDER_SERVICE_NAME ?? null,
    commitSha: process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? null,
    pmDisabledReason,
  };
  return redactValue({ ...baseMeta, ...meta }) as LogMeta;
};

const shouldReportToPm = (level: LogLevel): boolean => {
  return level === "error" || level === "warn";
};

const reportLog = async (level: PMLevel, message: string, meta: LogMeta, err?: unknown) => {
  if (!shouldReportToPm(level)) {
    return;
  }
  await reportToPM(level, message, meta, err);
};

export const logInfo = async (code: string, meta?: LogMeta): Promise<void> => {
  const payloadMeta = enrichMeta(normalizeMeta(meta));
  console.log(formatLogOutput("info", code, payloadMeta));
};

export const logWarn = async (code: string, meta?: LogMeta): Promise<void> => {
  const payloadMeta = enrichMeta(normalizeMeta(meta));
  console.warn(formatLogOutput("warn", code, payloadMeta));
  await reportLog("warn", code, payloadMeta);
};

export const logError = async (code: string, meta?: LogMeta, err?: unknown): Promise<void> => {
  const payloadMeta = enrichMeta(normalizeMeta(meta));
  if (err) {
    payloadMeta.error = formatErrorDetails(err);
  }
  console.error(formatLogOutput("error", code, payloadMeta));
  await reportLog("error", code, payloadMeta, err);
};

export const sendPingTest = async (): Promise<void> => {
  const message = "Ping test from Project X";
  await logInfo(message);
};
