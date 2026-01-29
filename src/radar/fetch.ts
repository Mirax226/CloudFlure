import axios from "axios";
import { logError } from "../logger.js";

export type RadarMode = "public" | "token" | "auto";

export type RadarTimeseriesPoint = {
  timestamp: string;
  value: number;
};

export type RadarFetchParams = {
  dateRange?: string;
  location?: string;
};

export type RadarFetchConfig = {
  mode: RadarMode;
  token?: string | null;
  publicBaseUrl: string;
  tokenBaseUrl: string;
  timeoutMs: number;
  retryMax: number;
  retryBaseDelayMs: number;
};

export type RadarNormalizedData = {
  points: RadarTimeseriesPoint[];
  source: "public" | "token";
};

export type RadarErrorCode =
  | "RADAR_BAD_REQUEST"
  | "RADAR_UNAUTHORIZED"
  | "RADAR_RATE_LIMIT"
  | "RADAR_UPSTREAM"
  | "RADAR_TIMEOUT"
  | "RADAR_NETWORK"
  | "RADAR_INVALID_DATA";

export class RadarFetchError extends Error {
  code: RadarErrorCode;
  status?: number;
  responseBody?: string;
  url?: string;
  params?: RadarFetchParams;

  constructor(
    code: RadarErrorCode,
    message: string,
    meta?: {
      status?: number;
      responseBody?: string;
      url?: string;
      params?: RadarFetchParams;
    }
  ) {
    super(message);
    this.code = code;
    this.status = meta?.status;
    this.responseBody = meta?.responseBody;
    this.url = meta?.url;
    this.params = meta?.params;
  }
}

const normalizeTimestamp = (value: unknown): string | null => {
  if (!value) {
    return null;
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
};

const normalizePoint = (point: Record<string, unknown>): RadarTimeseriesPoint | null => {
  const timestamp = normalizeTimestamp(point.timestamp ?? point.ts ?? point.time);
  const rawValue = point.value ?? point.requests ?? point.traffic ?? point.count ?? point.ratio;
  if (!timestamp || rawValue === null || rawValue === undefined) {
    return null;
  }
  const value = Number(rawValue);
  if (Number.isNaN(value)) {
    return null;
  }
  return { timestamp, value };
};

export const parseRadarResponse = (payload: unknown): RadarTimeseriesPoint[] => {
  const result = (payload as { result?: unknown })?.result ?? payload;
  if (!result || typeof result !== "object") {
    return [];
  }

  const record = result as Record<string, unknown>;
  const directSeries = record.timeseries ?? record.timeSeries ?? record.series;
  if (Array.isArray(directSeries)) {
    return directSeries
      .map((item) => (typeof item === "object" && item ? normalizePoint(item as Record<string, unknown>) : null))
      .filter((item): item is RadarTimeseriesPoint => Boolean(item));
  }

  const timeseries = record.timeseries as Record<string, unknown> | undefined;
  if (timeseries) {
    const timestamps = timeseries.timestamps as unknown[] | undefined;
    const values = timeseries.values as unknown[] | undefined;
    if (Array.isArray(timestamps) && Array.isArray(values)) {
      const points: RadarTimeseriesPoint[] = [];
      const count = Math.min(timestamps.length, values.length);
      for (let index = 0; index < count; index += 1) {
        const timestamp = normalizeTimestamp(timestamps[index]);
        const value = Number(values[index]);
        if (timestamp && !Number.isNaN(value)) {
          points.push({ timestamp, value });
        }
      }
      return points;
    }
  }

  const series = record.series as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(series) && series.length > 0) {
    const first = series[0];
    const timestamps = first.timestamps as unknown[] | undefined;
    const values = first.values as unknown[] | undefined;
    if (Array.isArray(timestamps) && Array.isArray(values)) {
      const points: RadarTimeseriesPoint[] = [];
      const count = Math.min(timestamps.length, values.length);
      for (let index = 0; index < count; index += 1) {
        const timestamp = normalizeTimestamp(timestamps[index]);
        const value = Number(values[index]);
        if (timestamp && !Number.isNaN(value)) {
          points.push({ timestamp, value });
        }
      }
      return points;
    }
  }

  return [];
};

export const validateRadarData = (points: RadarTimeseriesPoint[]): boolean => {
  if (!Array.isArray(points) || points.length === 0) {
    return false;
  }
  return points.every((point) =>
    Boolean(point && typeof point.timestamp === "string" && typeof point.value === "number" && !Number.isNaN(point.value))
  );
};

const truncate = (value: unknown, max = 1000): string => {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}…`;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getBackoffDelay = (baseDelayMs: number, attempt: number): number => {
  return baseDelayMs * Math.pow(2, attempt);
};

const normalizeParams = (params: RadarFetchParams): Required<RadarFetchParams> => {
  return {
    dateRange: params.dateRange ?? "1d",
    location: params.location ?? "IR",
  };
};

export const buildRadarUrl = (params: RadarFetchParams, baseUrl: string): string => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL("http/timeseries", normalizedBase);
  const normalizedParams = normalizeParams(params);
  url.searchParams.set("dateRange", normalizedParams.dateRange);
  url.searchParams.set("location", normalizedParams.location);
  return url.toString();
};

const mapAxiosError = async (
  error: unknown,
  meta: { url: string; params: RadarFetchParams }
): Promise<RadarFetchError> => {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const responseBody = error.response ? truncate(error.response.data) : undefined;
    const code = error.code;

    if (status) {
      const mappedCode: RadarErrorCode =
        status === 400
          ? "RADAR_BAD_REQUEST"
          : status === 401 || status === 403
            ? "RADAR_UNAUTHORIZED"
            : status === 429
              ? "RADAR_RATE_LIMIT"
              : status >= 500
                ? "RADAR_UPSTREAM"
                : "RADAR_NETWORK";

      await logError("radar_fetch_failed", {
        status,
        responseBody,
        url: meta.url,
        params: meta.params,
      });

      return new RadarFetchError(mappedCode, `Radar API responded with status ${status}`, {
        status,
        responseBody,
        url: meta.url,
        params: meta.params,
      });
    }

    if (code === "ECONNABORTED") {
      await logError("radar_fetch_timeout", { url: meta.url, params: meta.params });
      return new RadarFetchError("RADAR_TIMEOUT", "Radar API request timed out", {
        url: meta.url,
        params: meta.params,
      });
    }

    await logError("radar_fetch_network_error", {
      url: meta.url,
      params: meta.params,
      message: error.message,
    });

    return new RadarFetchError("RADAR_NETWORK", "Radar API network error", {
      url: meta.url,
      params: meta.params,
    });
  }

  return new RadarFetchError("RADAR_NETWORK", "Radar API request failed", {
    url: meta.url,
    params: meta.params,
  });
};

const shouldRetry = (code: RadarErrorCode): boolean => {
  return code === "RADAR_RATE_LIMIT" || code === "RADAR_UPSTREAM" || code === "RADAR_TIMEOUT" || code === "RADAR_NETWORK";
};

const fetchFromMode = async (
  params: RadarFetchParams,
  config: RadarFetchConfig,
  mode: "public" | "token"
): Promise<RadarTimeseriesPoint[]> => {
  const url = buildRadarUrl(params, mode === "public" ? config.publicBaseUrl : config.tokenBaseUrl);
  const headers: Record<string, string> = {
    "User-Agent": "CloudFlureBot/1.0",
  };
  if (mode === "token") {
    if (!config.token) {
      throw new RadarFetchError("RADAR_UNAUTHORIZED", "Radar API token is missing", {
        url,
        params,
      });
    }
    headers.Authorization = `Bearer ${config.token}`;
  }

  const normalizedParams = normalizeParams(params);

  for (let attempt = 0; attempt <= config.retryMax; attempt += 1) {
    try {
      const response = await axios.get(url, {
        timeout: config.timeoutMs,
        headers,
      });
      const points = parseRadarResponse(response.data);
      if (!validateRadarData(points)) {
        throw new RadarFetchError("RADAR_INVALID_DATA", "Radar API returned invalid data", {
          url,
          params: normalizedParams,
        });
      }
      return points;
    } catch (error) {
      const radarError = error instanceof RadarFetchError ? error : await mapAxiosError(error, { url, params: normalizedParams });
      if (!shouldRetry(radarError.code) || attempt >= config.retryMax) {
        throw radarError;
      }
      let delayMs = getBackoffDelay(config.retryBaseDelayMs, attempt);
      if (radarError.code === "RADAR_RATE_LIMIT" && axios.isAxiosError(error)) {
        const retryAfter = error.response?.headers?.["retry-after"];
        const retrySeconds = retryAfter ? Number(retryAfter) : Number.NaN;
        if (!Number.isNaN(retrySeconds) && retrySeconds > 0) {
          delayMs = retrySeconds * 1000;
        }
      }
      await delay(delayMs);
    }
  }

  throw new RadarFetchError("RADAR_NETWORK", "Radar API request failed", { url, params: normalizedParams });
};

export const fetchRadarData = async (
  params: RadarFetchParams,
  config: RadarFetchConfig
): Promise<RadarNormalizedData> => {
  const mode = config.mode;
  if (mode === "public") {
    const points = await fetchFromMode(params, config, "public");
    return { points, source: "public" };
  }
  if (mode === "token") {
    const points = await fetchFromMode(params, config, "token");
    return { points, source: "token" };
  }

  try {
    const points = await fetchFromMode(params, config, "public");
    return { points, source: "public" };
  } catch (error) {
    const radarError = error as RadarFetchError;
    const canFallback =
      radarError instanceof RadarFetchError &&
      radarError.code !== "RADAR_BAD_REQUEST" &&
      radarError.code !== "RADAR_INVALID_DATA";
    if (canFallback && config.token) {
      const points = await fetchFromMode(params, config, "token");
      return { points, source: "token" };
    }
    throw radarError;
  }
};

export const testPublicRadarEndpoint = async (config: RadarFetchConfig): Promise<{ ok: boolean; error?: string }> => {
  try {
    await fetchFromMode({ dateRange: "1d", location: "IR" }, config, "public");
    return { ok: true };
  } catch (error) {
    const radarError = error as RadarFetchError;
    return { ok: false, error: radarError.message };
  }
};

export const testTokenRadarEndpoint = async (config: RadarFetchConfig): Promise<{ ok: boolean; error?: string }> => {
  try {
    await fetchFromMode({ dateRange: "1d", location: "IR" }, config, "token");
    return { ok: true };
  } catch (error) {
    const radarError = error as RadarFetchError;
    return { ok: false, error: radarError.message };
  }
};
