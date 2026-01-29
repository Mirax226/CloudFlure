type LogLevel = "info" | "warn" | "error";

type LogMeta = Record<string, unknown>;

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

export const logInfo = async (message: string, meta?: LogMeta): Promise<void> => {
  const payloadMeta = normalizeMeta(meta);
  console.log(formatLogOutput("info", message, payloadMeta));
};

export const logWarn = async (message: string, meta?: LogMeta): Promise<void> => {
  const payloadMeta = normalizeMeta(meta);
  console.warn(formatLogOutput("warn", message, payloadMeta));
};

export const logError = async (message: string, meta?: unknown): Promise<void> => {
  const payloadMeta = normalizeMeta(meta);
  console.error(formatLogOutput("error", message, payloadMeta));
};

export const sendPingTest = async (): Promise<void> => {
  const message = "Ping test from Project X";
  await logInfo(message);
};
