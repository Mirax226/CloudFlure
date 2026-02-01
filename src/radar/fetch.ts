import { logError, logWarn } from "../logger.js";
import { requestRadar, RadarHttpError, probeRadarPublicEndpoint, isRadarTokenValidFormat } from "./client.js";
import {
  buildEndpointParams,
  DEFAULT_RADAR_ENDPOINT,
  RadarConfigError,
  type RadarEndpointDefinition,
  type RadarEndpointParams,
} from "./endpoints.js";
import { rangePresetToApiParams, type RadarDateRangePreset, type RadarApiDateRangeParams } from "./dateRange.js";

export type RadarMode = "public" | "token" | "auto";

export type RadarFetchConfig = {
  mode: RadarMode;
  token?: string | null;
  timeoutMs: number;
  dateRangePreset: RadarDateRangePreset;
};

export type RadarChartData = {
  labels: string[];
  values: number[];
  source: "public" | "token";
  endpoint: string;
  params: RadarEndpointParams;
  dateRangePreset: RadarDateRangePreset;
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
  | "RADAR_TOKEN_MISSING"
  | "RADAR_ROUTE_INVALID";

export class RadarFetchError extends Error {
  code: RadarErrorCode;
  status?: number;
  errors?: { code?: number | string; message?: string }[];
  endpoint?: string;
  params?: RadarEndpointParams;
  timingMs?: number;
  responseBody?: string;
  modeUsed?: "public" | "token";

  constructor(
    code: RadarErrorCode,
    message: string,
    meta?: {
      status?: number;
      errors?: { code?: number | string; message?: string }[];
      endpoint?: string;
      params?: RadarEndpointParams;
      timingMs?: number;
      responseBody?: string;
      modeUsed?: "public" | "token";
    }
  ) {
    super(message);
    this.code = code;
    this.status = meta?.status;
    this.errors = meta?.errors;
    this.endpoint = meta?.endpoint;
    this.params = meta?.params;
    this.timingMs = meta?.timingMs;
    this.responseBody = meta?.responseBody;
    this.modeUsed = meta?.modeUsed;
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

const extractResultPayload = (payload: unknown): unknown => {
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  const record = payload as Record<string, unknown>;
  if ("result" in record) {
    return record.result;
  }
  return payload;
};

const parseRadarResponseErrors = (responseBody?: string): { message?: string; code?: number | string }[] | undefined => {
  if (!responseBody) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(responseBody) as { errors?: { message?: string; code?: number | string }[] };
    return parsed.errors;
  } catch {
    return undefined;
  }
};

const isRouteInvalidError = (errors?: { message?: string }[], responseBody?: string): boolean => {
  const message = errors?.[0]?.message ?? "";
  if (message.includes("No route for that URI")) {
    return true;
  }
  return responseBody?.includes("No route for that URI") ?? false;
};

const mapRadarError = (
  status: number,
  endpoint: RadarEndpointDefinition,
  params: RadarEndpointParams,
  responseBody?: string,
  modeUsed?: "public" | "token"
): RadarFetchError => {
  const parsedErrors = parseRadarResponseErrors(responseBody);
  if (isRouteInvalidError(parsedErrors, responseBody)) {
    return new RadarFetchError("RADAR_ROUTE_INVALID", "Radar API route invalid", {
      status,
      endpoint: endpoint.path,
      params,
      responseBody,
      modeUsed,
      errors: parsedErrors,
    });
  }
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
    endpoint: endpoint.path,
    params,
    responseBody,
    modeUsed,
    errors: parsedErrors,
  });
};

const fetchFromSource = async (
  params: RadarEndpointParams,
  config: RadarFetchConfig,
  endpoint: RadarEndpointDefinition,
  source: "public" | "token",
  dateRangeParams: RadarApiDateRangeParams
): Promise<RadarChartData> => {
  if (source === "token" && !config.token) {
    throw new RadarFetchError("RADAR_TOKEN_MISSING", "Radar API token is missing", {
      endpoint: endpoint.path,
      params,
    });
  }

  const normalizedParams = buildEndpointParams({ ...params, ...dateRangeParams }, endpoint);

  let response: { data: { success?: boolean; result?: unknown; errors?: { message?: string; code?: number | string }[] } };
  let modeUsed: "public" | "token" = source;
  try {
    const result = await requestRadar<{ success?: boolean; result?: unknown; errors?: { message?: string; code?: number | string }[] }>(
      endpoint.path,
      normalizedParams,
      source,
      source === "token" ? config.token ?? undefined : undefined,
      { timeoutMs: config.timeoutMs }
    );
    response = { data: result.data };
    modeUsed = result.meta.modeUsed;
  } catch (error) {
    if (error instanceof RadarHttpError) {
      await logError("radar_fetch_failed", {
        status: error.status,
        url: error.url,
        path: error.path,
        params: error.params,
        modeUsed: error.modeUsed,
        responseBody: error.responseBodyTrunc,
        dateRangePreset: config.dateRangePreset,
      });
      throw mapRadarError(error.status, endpoint, normalizedParams, error.responseBodyTrunc, error.modeUsed);
    }
    await logError("radar_fetch_failed", {
      status: 0,
      endpoint: endpoint.path,
      params: normalizedParams,
      modeUsed: source,
      dateRangePreset: config.dateRangePreset,
    }, error);
    throw new RadarFetchError("RADAR_NETWORK", "Radar API request failed", {
      status: 0,
      endpoint: endpoint.path,
      params: normalizedParams,
      modeUsed: source,
    });
  }

  const payload = response.data;
  if (!payload) {
    throw new RadarFetchError("RADAR_INVALID_DATA", "Radar API returned invalid response", {
      status: 200,
      endpoint: endpoint.path,
      params: normalizedParams,
      modeUsed,
      responseBody: JSON.stringify(payload ?? ""),
    });
  }
  if (payload.success === false) {
    const summary = payload.errors?.[0]?.message ?? "Radar API responded with errors";
    const responseBody = JSON.stringify(payload ?? "");
    const parsedErrors = payload.errors ?? parseRadarResponseErrors(responseBody);
    if (isRouteInvalidError(parsedErrors, responseBody)) {
      throw new RadarFetchError("RADAR_ROUTE_INVALID", "Radar API route invalid", {
        status: 200,
        endpoint: endpoint.path,
        params: normalizedParams,
        modeUsed,
        responseBody,
        errors: parsedErrors,
      });
    }
    throw new RadarFetchError("RADAR_INVALID_DATA", summary, {
      status: 200,
      endpoint: endpoint.path,
      params: normalizedParams,
      modeUsed,
      responseBody,
      errors: parsedErrors,
    });
  }

  const resultPayload = extractResultPayload(payload);
  const { labels, values } = buildRadarChartData(resultPayload, normalizedParams.limit ?? endpoint.defaults.limit);
  if (!validateRadarData(labels, values)) {
    throw new RadarFetchError("RADAR_EMPTY_DATA", "Radar API returned empty data", {
      status: 200,
      endpoint: endpoint.path,
      params: normalizedParams,
      modeUsed,
      responseBody: JSON.stringify(payload ?? ""),
    });
  }

  return {
    labels,
    values,
    source: modeUsed,
    endpoint: endpoint.path,
    params: normalizedParams,
    dateRangePreset: config.dateRangePreset,
    label: endpoint.label,
  };
};

const isFallbackForPublic = (error: RadarFetchError): boolean => {
  if (error.code === "RADAR_ROUTE_INVALID") {
    return false;
  }
  return (error.status ?? 0) >= 400 && (error.status ?? 0) < 500;
};

export const fetchRadarData = async (
  params: RadarEndpointParams,
  config: RadarFetchConfig,
  endpoint: RadarEndpointDefinition = DEFAULT_RADAR_ENDPOINT
): Promise<RadarChartData> => {
  const { primary, fallback } = rangePresetToApiParams(config.dateRangePreset);
  const dateRangeParams = config.mode === "public"
    ? await resolvePublicDateRangeParams(primary, fallback)
    : primary;

  const fetchWithFallback = async (
    source: "public" | "token",
    rangeParams: RadarApiDateRangeParams,
    allowFallback: boolean
  ): Promise<RadarChartData> => {
    try {
      return await fetchFromSource(params, config, endpoint, source, rangeParams);
    } catch (error) {
      const radarError = error as RadarFetchError;
      if (allowFallback && radarError instanceof RadarFetchError && radarError.code === "RADAR_BAD_REQUEST" && fallback) {
        await logWarn("radar_range_fallback_used", {
          preset: config.dateRangePreset,
          usedParams: fallback,
        });
        return await fetchFromSource(params, config, endpoint, source, fallback);
      }
      throw error;
    }
  };

  if (config.mode === "public") {
    if (!endpoint.supportsPublic) {
      throw new RadarFetchError("RADAR_PUBLIC_UNSUPPORTED", "Public not available for this chart", {
        endpoint: endpoint.path,
        params,
      });
    }
    return fetchWithFallback("public", dateRangeParams, true);
  }

  if (config.mode === "token") {
    if (!isRadarTokenValidFormat(config.token ?? null)) {
      throw new RadarFetchError("RADAR_UNAUTHORIZED", "Radar token format is invalid", {
        endpoint: endpoint.path,
        params,
        modeUsed: "token",
      });
    }
    return fetchWithFallback("token", primary, true);
  }

  if (!endpoint.supportsPublic) {
    return fetchWithFallback("token", primary, true);
  }

  if (!isRadarTokenValidFormat(config.token ?? null)) {
    await logWarn("radar_auto_invalid_token_fallback_public", {
      endpoint: endpoint.path,
      params,
      modeUsed: "token",
      dateRangePreset: config.dateRangePreset,
    });
    return fetchWithFallback("public", dateRangeParams, true);
  }

  try {
    return await fetchWithFallback("token", primary, true);
  } catch (error) {
    if (error instanceof RadarConfigError) {
      throw error;
    }
    const radarError = error as RadarFetchError;
    if (radarError instanceof RadarFetchError && isFallbackForPublic(radarError)) {
      await logWarn("radar_auto_fallback_public", {
        endpoint: endpoint.path,
        params: radarError.params ?? params,
        status: radarError.status,
        modeUsed: radarError.modeUsed,
        responseBody: radarError.responseBody,
        dateRangePreset: config.dateRangePreset,
      });
      return await fetchFromSource(params, config, endpoint, "public", dateRangeParams);
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
  responseBody?: string | null;
};

export const diagnoseRadar = async (
  params: RadarEndpointParams,
  config: RadarFetchConfig,
  endpoint: RadarEndpointDefinition = DEFAULT_RADAR_ENDPOINT
): Promise<RadarDiagnostics> => {
  const { primary } = rangePresetToApiParams(config.dateRangePreset);
  const normalizedParams = buildEndpointParams({ ...params, ...primary }, endpoint);
  const buildResult = (
    source: "public" | "token",
    status: number,
    responseBody?: string
  ): RadarDiagnostics => ({
    configuredMode: config.mode,
    effectiveSource: source,
    endpoint: endpoint.path,
    params: normalizedParams,
    status,
    timingMs: null,
    errorSummary: responseBody ? truncateErrorBody(responseBody) : null,
    responseBody,
  });

  try {
    const result = await requestRadar(endpoint.path, normalizedParams, config.mode, config.token ?? undefined, {
      timeoutMs: config.timeoutMs,
    });
    return buildResult(result.meta.modeUsed, result.meta.status);
  } catch (error) {
    if (error instanceof RadarHttpError) {
      return buildResult(error.modeUsed, error.status, error.responseBodyTrunc);
    }
    return buildResult("public", 0, "Unknown error");
  }
};

const truncateErrorBody = (body: string): string => {
  if (body.length <= 200) {
    return body;
  }
  return `${body.slice(0, 200)}…`;
};

const resolvePublicDateRangeParams = async (
  primary: RadarApiDateRangeParams,
  fallback?: RadarApiDateRangeParams
): Promise<RadarApiDateRangeParams> => {
  const contract = await probeRadarPublicEndpoint();
  if (contract.paramMode === "sinceUntil" && primary.since && primary.until) {
    return primary;
  }
  if (contract.paramMode === "sinceUntil" && primary.dateRange) {
    const converted = convertDateRangeToSinceUntil(primary.dateRange);
    if (converted) {
      return converted;
    }
  }
  if (contract.paramMode === "dateRange" && primary.dateRange) {
    return primary;
  }
  if (fallback) {
    await logWarn("radar_public_range_fallback_used", {
      presetFallback: fallback,
      modeUsed: "public",
    });
    return fallback;
  }
  return primary;
};

const convertDateRangeToSinceUntil = (dateRange: string): RadarApiDateRangeParams | null => {
  const match = dateRange.match(/^(\d+)d$/);
  if (!match) {
    return null;
  }
  const days = Number(match[1]);
  if (!Number.isFinite(days) || days <= 0) {
    return null;
  }
  const until = new Date();
  const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);
  return { since: since.toISOString(), until: until.toISOString() };
};
