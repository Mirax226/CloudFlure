import { logError } from "../logger.js";
import { radarRequest } from "./client.js";
import {
  buildEndpointParams,
  DEFAULT_RADAR_ENDPOINT,
  RadarConfigError,
  type RadarEndpointDefinition,
  type RadarEndpointParams,
} from "./endpoints.js";

export type RadarMode = "public" | "token" | "auto";

export type RadarFetchConfig = {
  mode: RadarMode;
  token?: string | null;
  publicBaseUrl: string;
  tokenBaseUrl: string;
  timeoutMs: number;
  retryMax: number;
  retryBaseDelayMs: number;
};

export type RadarChartData = {
  labels: string[];
  values: number[];
  source: "public" | "token";
  endpoint: string;
  params: RadarEndpointParams;
  label: string;
};

export type RadarErrorCode =
  | "RADAR_BAD_REQUEST"
  | "RADAR_UNAUTHORIZED"
  | "RADAR_RATE_LIMIT"
  | "RADAR_UPSTREAM"
  | "RADAR_TIMEOUT"
  | "RADAR_NETWORK"
  | "RADAR_INVALID_DATA"
  | "RADAR_EMPTY_DATA"
  | "RADAR_PUBLIC_UNSUPPORTED"
  | "RADAR_TOKEN_MISSING";

export class RadarFetchError extends Error {
  code: RadarErrorCode;
  status?: number;
  errors?: { code?: number | string; message?: string }[];
  endpoint?: string;
  params?: RadarEndpointParams;
  timingMs?: number;

  constructor(
    code: RadarErrorCode,
    message: string,
    meta?: {
      status?: number;
      errors?: { code?: number | string; message?: string }[];
      endpoint?: string;
      params?: RadarEndpointParams;
      timingMs?: number;
    }
  ) {
    super(message);
    this.code = code;
    this.status = meta?.status;
    this.errors = meta?.errors;
    this.endpoint = meta?.endpoint;
    this.params = meta?.params;
    this.timingMs = meta?.timingMs;
  }
}

export const validateRadarData = (labels: string[], values: number[]): boolean => {
  if (!Array.isArray(labels) || !Array.isArray(values) || labels.length === 0 || labels.length !== values.length) {
    return false;
  }
  return values.every((value) => Number.isFinite(value));
};

const normalizeItemValue = (value: unknown): number | null => {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return null;
  }
  return numeric;
};

const pickLabel = (record: Record<string, unknown>, fallback: string): string => {
  const labelValue =
    record.name ?? record.label ?? record.country ?? record.location ?? record.id ?? record.code ?? record.region ?? fallback;
  return String(labelValue);
};

const normalizeRecords = (items: Array<Record<string, unknown>>, limit: number): { labels: string[]; values: number[] } => {
  const labels: string[] = [];
  const values: number[] = [];
  for (const item of items) {
    const value =
      normalizeItemValue(item.value ?? item.count ?? item.requests ?? item.traffic ?? item.ratio ?? item.total ?? item.share);
    if (value === null) {
      continue;
    }
    labels.push(pickLabel(item, `Item ${labels.length + 1}`));
    values.push(value);
    if (labels.length >= limit) {
      break;
    }
  }
  return { labels, values };
};

const extractRecords = (result: unknown): Array<Record<string, unknown>> => {
  if (!result) {
    return [];
  }

  if (Array.isArray(result)) {
    return result.filter((item) => typeof item === "object" && item !== null) as Array<Record<string, unknown>>;
  }

  if (typeof result !== "object") {
    return [];
  }

  const record = result as Record<string, unknown>;
  const top = record.top;
  if (Array.isArray(top)) {
    return top.filter((item) => typeof item === "object" && item !== null) as Array<Record<string, unknown>>;
  }

  const data = record.data;
  if (Array.isArray(data)) {
    return data.filter((item) => typeof item === "object" && item !== null) as Array<Record<string, unknown>>;
  }

  const series = record.series;
  if (Array.isArray(series)) {
    return series.filter((item) => typeof item === "object" && item !== null) as Array<Record<string, unknown>>;
  }

  const topKeys = Object.keys(record).filter((key) => key.startsWith("top_"));
  if (topKeys.length > 0) {
    return topKeys
      .sort((a, b) => a.localeCompare(b))
      .map((key) => record[key])
      .filter((item) => typeof item === "object" && item !== null) as Array<Record<string, unknown>>;
  }

  return [];
};

const buildRadarChartData = (
  result: unknown,
  limit: number
): { labels: string[]; values: number[] } => {
  const records = extractRecords(result);
  return normalizeRecords(records, limit);
};

const mapRadarError = (
  status: number,
  timingMs: number,
  endpoint: RadarEndpointDefinition,
  params: RadarEndpointParams,
  errors: { code?: number | string; message?: string }[]
): RadarFetchError => {
  const code: RadarErrorCode =
    status === 400
      ? "RADAR_BAD_REQUEST"
      : status === 401 || status === 403
        ? "RADAR_UNAUTHORIZED"
        : status === 429
          ? "RADAR_RATE_LIMIT"
          : status >= 500
            ? "RADAR_UPSTREAM"
            : status === 0
              ? "RADAR_NETWORK"
              : "RADAR_NETWORK";
  return new RadarFetchError(code, `Radar API responded with status ${status}`, {
    status,
    errors,
    endpoint: endpoint.path,
    params,
    timingMs,
  });
};

const fetchFromSource = async (
  params: RadarEndpointParams,
  config: RadarFetchConfig,
  endpoint: RadarEndpointDefinition,
  source: "public" | "token"
): Promise<RadarChartData> => {
  if (source === "token" && !config.token) {
    throw new RadarFetchError("RADAR_TOKEN_MISSING", "Radar API token is missing", {
      endpoint: endpoint.path,
      params,
    });
  }

  const normalizedParams = buildEndpointParams(params, endpoint);
  const baseUrl = source === "public" ? config.publicBaseUrl : config.tokenBaseUrl;

  const response = await radarRequest({
    baseUrl,
    path: endpoint.path,
    params: normalizedParams,
    token: source === "token" ? config.token : null,
    timeoutMs: config.timeoutMs,
    retryMax: config.retryMax,
    retryBaseDelayMs: config.retryBaseDelayMs,
  });

  if (!response.ok) {
    await logError("radar_fetch_failed", {
      status: response.status,
      errors: response.errors,
      endpoint: endpoint.path,
      params: normalizedParams,
      source,
    });
    throw mapRadarError(response.status, response.timingMs, endpoint, normalizedParams, response.errors);
  }

  const { labels, values } = buildRadarChartData(response.result, normalizedParams.limit ?? endpoint.defaults.limit);
  if (!validateRadarData(labels, values)) {
    throw new RadarFetchError("RADAR_EMPTY_DATA", "Radar API returned empty data", {
      status: response.status,
      errors: response.errors,
      endpoint: endpoint.path,
      params: normalizedParams,
      timingMs: response.timingMs,
    });
  }

  return {
    labels,
    values,
    source,
    endpoint: endpoint.path,
    params: normalizedParams,
    label: endpoint.label,
  };
};

const shouldFallbackToToken = (error: RadarFetchError): boolean => {
  return (
    error.code === "RADAR_UNAUTHORIZED" ||
    error.code === "RADAR_RATE_LIMIT" ||
    error.code === "RADAR_UPSTREAM" ||
    error.code === "RADAR_TIMEOUT" ||
    error.code === "RADAR_NETWORK"
  );
};

export const fetchRadarData = async (
  params: RadarEndpointParams,
  config: RadarFetchConfig,
  endpoint: RadarEndpointDefinition = DEFAULT_RADAR_ENDPOINT
): Promise<RadarChartData> => {
  if (config.mode === "public") {
    if (!endpoint.supportsPublic) {
      throw new RadarFetchError("RADAR_PUBLIC_UNSUPPORTED", "Public not available for this chart", {
        endpoint: endpoint.path,
        params,
      });
    }
    return fetchFromSource(params, config, endpoint, "public");
  }

  if (config.mode === "token") {
    return fetchFromSource(params, config, endpoint, "token");
  }

  if (!endpoint.supportsPublic) {
    return fetchFromSource(params, config, endpoint, "token");
  }

  try {
    return await fetchFromSource(params, config, endpoint, "public");
  } catch (error) {
    if (error instanceof RadarConfigError) {
      throw error;
    }
    const radarError = error as RadarFetchError;
    if (radarError instanceof RadarFetchError && shouldFallbackToToken(radarError)) {
      return await fetchFromSource(params, config, endpoint, "token");
    }
    throw radarError;
  }
};

export type RadarDiagnostics = {
  configuredMode: RadarMode;
  effectiveSource: "public" | "token" | null;
  endpoint: string;
  params: RadarEndpointParams;
  status: number | null;
  timingMs: number | null;
  errorSummary: string | null;
};

const summarizeErrors = (errors?: { code?: number | string; message?: string }[]): string | null => {
  if (!errors || errors.length === 0) {
    return null;
  }
  const first = errors[0];
  if (first.code && first.message) {
    return `${first.code}: ${first.message}`;
  }
  return first.message ?? String(first.code ?? "Unknown error");
};

export const diagnoseRadar = async (
  params: RadarEndpointParams,
  config: RadarFetchConfig,
  endpoint: RadarEndpointDefinition = DEFAULT_RADAR_ENDPOINT
): Promise<RadarDiagnostics> => {
  const normalizedParams = buildEndpointParams(params, endpoint);
  const buildResult = (
    source: "public" | "token",
    status: number,
    timingMs: number,
    errors?: { code?: number | string; message?: string }[]
  ): RadarDiagnostics => ({
    configuredMode: config.mode,
    effectiveSource: source,
    endpoint: endpoint.path,
    params: normalizedParams,
    status,
    timingMs,
    errorSummary: summarizeErrors(errors),
  });

  if (config.mode === "public") {
    if (!endpoint.supportsPublic) {
      return {
        configuredMode: config.mode,
        effectiveSource: null,
        endpoint: endpoint.path,
        params: normalizedParams,
        status: null,
        timingMs: null,
        errorSummary: "Public not available for this chart",
      };
    }
    const response = await radarRequest({
      baseUrl: config.publicBaseUrl,
      path: endpoint.path,
      params: normalizedParams,
      timeoutMs: config.timeoutMs,
      retryMax: config.retryMax,
      retryBaseDelayMs: config.retryBaseDelayMs,
    });
    return buildResult("public", response.status, response.timingMs, response.errors);
  }

  if (config.mode === "token") {
    const response = await radarRequest({
      baseUrl: config.tokenBaseUrl,
      path: endpoint.path,
      params: normalizedParams,
      token: config.token,
      timeoutMs: config.timeoutMs,
      retryMax: config.retryMax,
      retryBaseDelayMs: config.retryBaseDelayMs,
    });
    return buildResult("token", response.status, response.timingMs, response.errors);
  }

  if (!endpoint.supportsPublic) {
    const response = await radarRequest({
      baseUrl: config.tokenBaseUrl,
      path: endpoint.path,
      params: normalizedParams,
      token: config.token,
      timeoutMs: config.timeoutMs,
      retryMax: config.retryMax,
      retryBaseDelayMs: config.retryBaseDelayMs,
    });
    return buildResult("token", response.status, response.timingMs, response.errors);
  }

  const publicResponse = await radarRequest({
    baseUrl: config.publicBaseUrl,
    path: endpoint.path,
    params: normalizedParams,
    timeoutMs: config.timeoutMs,
    retryMax: config.retryMax,
    retryBaseDelayMs: config.retryBaseDelayMs,
  });
  if (publicResponse.ok) {
    return buildResult("public", publicResponse.status, publicResponse.timingMs, publicResponse.errors);
  }

  const publicError = mapRadarError(
    publicResponse.status,
    publicResponse.timingMs,
    endpoint,
    normalizedParams,
    publicResponse.errors
  );

  if (shouldFallbackToToken(publicError)) {
    const tokenResponse = await radarRequest({
      baseUrl: config.tokenBaseUrl,
      path: endpoint.path,
      params: normalizedParams,
      token: config.token,
      timeoutMs: config.timeoutMs,
      retryMax: config.retryMax,
      retryBaseDelayMs: config.retryBaseDelayMs,
    });
    return buildResult("token", tokenResponse.status, tokenResponse.timingMs, tokenResponse.errors);
  }

  return buildResult("public", publicResponse.status, publicResponse.timingMs, publicResponse.errors);
};
