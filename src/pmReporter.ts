import axios from "axios";

export type PMLevel = "info" | "warn" | "error";

export interface PMPayload {
  project: string;
  level: PMLevel;
  message: string;
  timestamp?: string;
  meta?: Record<string, unknown>;
}

const MAX_PAYLOAD_BYTES = 10 * 1024;
const MAX_STACK_CHARS = 1500;
const MAX_RESPONSE_BODY_CHARS = 2000;
const REQUEST_TIMEOUT_MS = 2500;
const RETRY_DELAY_MS = 300;

const DROP_META_KEYS = new Set(["config", "request", "response", "raw", "rawConfig"]);
const REDACT_KEY_PATTERN = /(token|authorization|api[_-]?token|path[_-]?applier|secret|password)/i;

let pmDisabledReason: string | null = null;

const getPmConfig = () => {
  const baseUrl = process.env.PM_BASE_URL?.trim() ?? "";
  const token = process.env.PATH_APPLIER_TOKEN?.trim() ?? "";
  const project = process.env.PM_PROJECT_NAME?.trim() ?? "cloudflare-radar-bot";
  if (!baseUrl || !token) {
    pmDisabledReason = !baseUrl ? "PM_BASE_URL missing" : "PATH_APPLIER_TOKEN missing";
    return { enabled: false, baseUrl, token, project };
  }
  pmDisabledReason = null;
  return { enabled: true, baseUrl, token, project };
};

export const getPmDisabledReason = (): string | null => pmDisabledReason;

const truncate = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}…`;
};

const sanitizeValue = (value: unknown, depth = 0): unknown => {
  if (value == null) {
    return value;
  }
  if (typeof value === "string") {
    return truncate(value, MAX_RESPONSE_BODY_CHARS);
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ? truncate(value.stack, MAX_STACK_CHARS) : undefined,
    };
  }
  if (Array.isArray(value)) {
    if (depth > 2) {
      return value.slice(0, 5);
    }
    return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
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
      return [[key, sanitizeValue(entry, depth + 1)]];
    });
    return Object.fromEntries(entries);
  }
  return value;
};

const ensurePayloadSize = (payload: PMPayload): PMPayload => {
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, "utf8") <= MAX_PAYLOAD_BYTES) {
    return payload;
  }
  const minimalMeta: Record<string, unknown> = {};
  if (payload.meta && typeof payload.meta === "object") {
    if ("error" in payload.meta) {
      minimalMeta.error = payload.meta.error;
    }
    if ("status" in payload.meta) {
      minimalMeta.status = payload.meta.status;
    }
    if ("endpoint" in payload.meta) {
      minimalMeta.endpoint = payload.meta.endpoint;
    }
    minimalMeta.truncated = true;
  }
  const shrunk: PMPayload = { ...payload, meta: minimalMeta };
  const shrunkSerialized = JSON.stringify(shrunk);
  if (Buffer.byteLength(shrunkSerialized, "utf8") <= MAX_PAYLOAD_BYTES) {
    return shrunk;
  }
  return {
    project: payload.project,
    level: payload.level,
    message: truncate(payload.message, 256),
    timestamp: payload.timestamp,
    meta: { truncated: true },
  };
};

const postPayload = async (url: string, payload: PMPayload, token: string): Promise<boolean> => {
  const response = await axios.post(url, payload, {
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    validateStatus: () => true,
  });
  return response.status >= 200 && response.status < 300;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const reportToPM = async (
  level: PMLevel,
  message: string,
  meta?: Record<string, unknown>,
  err?: unknown
): Promise<void> => {
  const { enabled, baseUrl, token, project } = getPmConfig();
  if (!enabled) {
    console.warn("pm_report_skipped", { reason: pmDisabledReason, message });
    return;
  }

  const metaPayload = sanitizeValue({
    ...meta,
    error: err ? sanitizeValue(err) : undefined,
  }) as Record<string, unknown>;

  const payload: PMPayload = ensurePayloadSize({
    project,
    level,
    message,
    timestamp: new Date().toISOString(),
    meta: metaPayload,
  });

  const primaryUrl = `${baseUrl.replace(/\/$/, "")}/api/logs`;
  const fallbackUrl = `${baseUrl.replace(/\/$/, "")}/api/pm/logs`;

  try {
    const primaryOk = await postPayload(primaryUrl, payload, token);
    if (primaryOk) {
      return;
    }
    await wait(RETRY_DELAY_MS);
    await postPayload(fallbackUrl, payload, token);
  } catch (error) {
    console.error("pm_report_failed", { error: error instanceof Error ? error.message : String(error) });
  }
};
