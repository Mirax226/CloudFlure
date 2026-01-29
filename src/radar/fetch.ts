import axios, { type AxiosInstance } from "axios";
import { logError } from "../logger.js";

export type RadarTimeseriesPoint = {
  timestamp: string;
  value: number;
};

const RADAR_BASE_URL = "https://api.cloudflare.com/client/v4/radar";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 600;

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

const extractTimeseries = (payload: unknown): RadarTimeseriesPoint[] => {
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

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const createRadarClient = (token: string): AxiosInstance => {
  return axios.create({
    baseURL: RADAR_BASE_URL,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "CloudFlureBot/1.0",
    },
  });
};

export const fetchIranTimeseries = async (token: string): Promise<RadarTimeseriesPoint[]> => {
  const client = createRadarClient(token);
  const params = {
    dateRange: "1d",
    location: "IR",
  };
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await client.get("/http/timeseries", { params });
      const points = extractTimeseries(response.data);
      if (!points.length) {
        throw new Error("Radar API returned no timeseries data");
      }
      return points;
    } catch (error) {
      lastError = error;
      if (axios.isAxiosError(error) && error.response) {
        const status = error.response.status;
        const responseData = error.response.data;
        if (status >= 400 && status < 500) {
          await logError("radar_api_4xx", {
            status,
            responseData,
            params,
            endpoint: "/http/timeseries",
          });
          throw error;
        }
      }
      if (attempt < MAX_RETRIES) {
        await delay(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      break;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Radar API request failed");
};
