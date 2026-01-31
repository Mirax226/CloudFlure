import axios from "axios";
import { logError } from "../logger.js";

export type RadarApiError = { code?: number | string; message?: string };

export type RadarRequestResult = {
  ok: boolean;
  status: number;
  result: unknown;
  errors: RadarApiError[];
  timingMs: number;
};

export type RadarRequestOptions = {
  baseUrl: string;
  path: string;
  params: Record<string, string | number | boolean>;
  token?: string | null;
  timeoutMs: number;
  retryMax: number;
  retryBaseDelayMs: number;
};

const ALLOWED_BASE_URL = "https://api.cloudflare.com/client/v4/radar";
const USER_AGENT = "CloudFlureBot/1.0";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getBackoffDelay = (baseDelayMs: number, attempt: number): number => {
  return baseDelayMs * Math.pow(3, attempt);
};

const shouldRetry = (status: number, errorCode?: string): boolean => {
  if (status === 429 || status >= 500) {
    return true;
  }
  return errorCode === "ECONNABORTED" || status === 0;
};

const normalizeBaseUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  if (!trimmed.startsWith(ALLOWED_BASE_URL)) {
    throw new Error(`Invalid Radar base URL: ${baseUrl}`);
  }
  return trimmed;
};

export const radarRequest = async (options: RadarRequestOptions): Promise<RadarRequestResult> => {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const url = new URL(options.path.replace(/^\//, ""), `${baseUrl}/`);
  Object.entries(options.params).forEach(([key, value]) => {
    url.searchParams.set(key, String(value));
  });

  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  for (let attempt = 0; attempt <= options.retryMax; attempt += 1) {
    const start = Date.now();
    try {
      const response = await axios.get(url.toString(), {
        timeout: options.timeoutMs,
        headers,
      });
      const timingMs = Date.now() - start;
      const payload = response.data as { success?: boolean; result?: unknown; errors?: RadarApiError[] } | undefined;
      if (!payload || typeof payload.success !== "boolean") {
        await logError("radar_response_invalid", { status: response.status, url: url.toString() });
        return {
          ok: false,
          status: response.status,
          result: null,
          errors: [{ message: "Invalid JSON response" }],
          timingMs,
        };
      }

      return {
        ok: payload.success,
        status: response.status,
        result: payload.result ?? null,
        errors: payload.errors ?? [],
        timingMs,
      };
    } catch (error) {
      const timingMs = Date.now() - start;
      if (axios.isAxiosError(error)) {
        const status = error.response?.status ?? 0;
        const errors: RadarApiError[] = [
          {
            code: error.code,
            message: error.response?.data?.errors?.[0]?.message ?? error.message,
          },
        ];

        if (!shouldRetry(status, error.code) || attempt >= options.retryMax) {
          return {
            ok: false,
            status,
            result: null,
            errors,
            timingMs,
          };
        }

        let delayMs = getBackoffDelay(options.retryBaseDelayMs, attempt);
        const retryAfter = error.response?.headers?.["retry-after"];
        const retrySeconds = retryAfter ? Number(retryAfter) : Number.NaN;
        if (!Number.isNaN(retrySeconds) && retrySeconds > 0) {
          delayMs = retrySeconds * 1000;
        }
        await delay(delayMs);
        continue;
      }

      if (attempt >= options.retryMax) {
        return {
          ok: false,
          status: 0,
          result: null,
          errors: [{ message: error instanceof Error ? error.message : "Unknown error" }],
          timingMs,
        };
      }

      await delay(getBackoffDelay(options.retryBaseDelayMs, attempt));
    }
  }

  return {
    ok: false,
    status: 0,
    result: null,
    errors: [{ message: "Radar request failed" }],
    timingMs: 0,
  };
};

export const getRadarBaseUrl = (): string => ALLOWED_BASE_URL;
