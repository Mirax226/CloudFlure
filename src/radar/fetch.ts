import axios from "axios";

export type RadarTimeseriesPoint = {
  timestamp: string;
  value: number;
};

const RADAR_API_URL = "https://api.cloudflare.com/client/v4/radar/traffic";

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

export const fetchIranTimeseries = async (): Promise<RadarTimeseriesPoint[]> => {
  const response = await axios.get(RADAR_API_URL, {
    params: {
      dateRange: "1d",
      location: "IR",
      format: "json",
    },
    headers: {
      "User-Agent": "CloudFlureBot/1.0",
    },
    timeout: 15_000,
  });

  const points = extractTimeseries(response.data);
  if (!points.length) {
    throw new Error("Radar API returned no timeseries data");
  }
  return points;
};
