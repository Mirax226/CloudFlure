import axios from "axios";
import { logInfo, logWarn } from "../logger.js";

export const CF_ORIGIN = "https://api.cloudflare.com";
export const CF_API_BASE = `${CF_ORIGIN}/client/v4`;
export const RADAR_BASE = `${CF_API_BASE}/radar`;

export type RadarAuthMode = "public" | "token" | "auto";

export type RadarQueryParamValue = string | number | boolean | Array<string | number> | undefined;

export type RadarRequestMeta = {
  url: string;
  status: number;
  modeUsed: "public" | "token";
};

export class RadarAuthError extends Error {
  code: "missing_token";

  constructor(code: "missing_token", message: string) {
    super(message);
    this.name = "RadarAuthError";
    this.code = code;
  }
}

export class RadarHttpError extends Error {
  status: number;
  url: string;
  path: string;
  params: Record<string, RadarQueryParamValue>;
  modeUsed: "public" | "token";
  responseBodyTrunc: string;

  constructor(message: string, details: Omit<RadarHttpError, "name" | "message">) {
    super(message);
    this.name = "RadarHttpError";
    this.status = details.status;
    this.url = details.url;
    this.path = details.path;
    this.params = details.params;
    this.modeUsed = details.modeUsed;
    this.responseBodyTrunc = details.responseBodyTrunc;
  }
}

const USER_AGENT = "CloudFlureBot/2.0";
const RESPONSE_BODY_LIMIT = 2000;
const DEFAULT_TIMEOUT_MS = 15_000;

const truncate = (value: string, maxChars: number) => (value.length > maxChars ? `${value.slice(0, maxChars)}…` : value);

const resolveRadarBaseUrl = (mode: "public" | "token"): string => {
  const envKey = mode === "public" ? "RADAR_PUBLIC_BASE_URL" : "RADAR_TOKEN_BASE_URL";
  const raw = process.env[envKey]?.trim();
  if (raw) {
    return raw.replace(/\/$/, "");
  }
  return RADAR_BASE;
};

const looksLikeRouteInvalid = (responseBody: string): boolean => {
  if (!responseBody) {
    return false;
  }
  if (responseBody.includes("No route for that URI")) {
    return true;
  }
  try {
    const parsed = JSON.parse(responseBody) as { errors?: { message?: string }[] };
    return parsed?.errors?.some((item) => item?.message?.includes("No route for that URI")) ?? false;
  } catch {
    return false;
  }
};

export const buildRadarUrl = (
  path: string,
  params: Record<string, RadarQueryParamValue>,
  baseUrl: string = RADAR_BASE
): string => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (!baseUrl.includes("/client/v4/radar")) {
    throw new Error("Radar base misconfigured");
  }
  const url = new URL(normalizedPath.slice(1), `${baseUrl.replace(/\/$/, "")}/`);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        url.searchParams.append(key, String(entry));
      });
      return;
    }
    url.searchParams.set(key, String(value));
  });
  return url.toString();
};

export const isRadarTokenValidFormat = (token?: string | null): boolean => {
  if (!token) {
    return false;
  }
  return /^[A-Za-z0-9_\-.]{20,}$/.test(token.trim());
};

const executeRequest = async <T>(
  path: string,
  params: Record<string, RadarQueryParamValue>,
  modeUsed: "public" | "token",
  token: string | undefined,
  timeoutMs: number
): Promise<{ data: T; meta: RadarRequestMeta }> => {
  const baseUrl = resolveRadarBaseUrl(modeUsed);
  const url = buildRadarUrl(path, params, baseUrl);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };
  if (modeUsed === "token" && token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await axios.get(url, {
    timeout: timeoutMs,
    headers,
    validateStatus: () => true,
  });
  const status = response.status;
  if (status < 200 || status >= 300) {
    const responseBody =
      typeof response.data === "string" ? response.data : JSON.stringify(response.data ?? "");
    throw new RadarHttpError("Radar API responded with non-2xx status", {
      status,
      url,
      path,
      params,
      modeUsed,
      responseBodyTrunc: truncate(responseBody, RESPONSE_BODY_LIMIT),
    });
  }
  return { data: response.data as T, meta: { url, status, modeUsed } };
};

const isFallbackStatus = (status: number): boolean => status >= 400 && status < 500;

export const requestRadar = async <T>(
  path: string,
  params: Record<string, RadarQueryParamValue>,
  mode: RadarAuthMode,
  token?: string,
  options?: { timeoutMs?: number }
): Promise<{ data: T; meta: RadarRequestMeta }> => {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const tokenValue = token?.trim();
  if (mode === "public") {
    return executeRequest<T>(path, params, "public", undefined, timeoutMs);
  }

  if (mode === "token") {
    if (!tokenValue) {
      throw new RadarAuthError("missing_token", "Radar API token is missing");
    }
    return executeRequest<T>(path, params, "token", tokenValue, timeoutMs);
  }

  if (tokenValue) {
    try {
      return await executeRequest<T>(path, params, "token", tokenValue, timeoutMs);
    } catch (error) {
      if (error instanceof RadarHttpError && isFallbackStatus(error.status)) {
        if (looksLikeRouteInvalid(error.responseBodyTrunc)) {
          throw error;
        }
        await logWarn("radar_auto_token_fallback_public", {
          status: error.status,
          endpoint: path,
          params,
          modeUsed: "token",
        });
        return executeRequest<T>(path, params, "public", undefined, timeoutMs);
      }
      throw error;
    }
  }

  return executeRequest<T>(path, params, "public", undefined, timeoutMs);
};

type PublicContract = {
  path: string;
  paramMode: "dateRange" | "sinceUntil";
  extraParams?: Record<string, string>;
};

let cachedPublicContract: PublicContract | null = null;

const deriveContractFromError = (responseBody: string): Partial<PublicContract> => {
  const normalized = responseBody.toLowerCase();
  if (normalized.includes("since") && normalized.includes("until")) {
    return { paramMode: "sinceUntil" };
  }
  if (normalized.includes("daterange")) {
    return { paramMode: "dateRange" };
  }
  return {};
};

const buildProbeDateRangeParams = () => ({ dateRange: "7d", limit: 10 });

const buildProbeSinceUntilParams = () => {
  const until = new Date();
  const since = new Date(until.getTime() - 7 * 24 * 60 * 60 * 1000);
  return {
    since: since.toISOString(),
    until: until.toISOString(),
    limit: 10,
  };
};

export const probeRadarPublicEndpoint = async (): Promise<PublicContract> => {
  if (cachedPublicContract) {
    return cachedPublicContract;
  }

  const basePath = "/http/top/locations/http_protocol/HTTPS";
  const candidates: Array<{
    path: string;
    paramMode: "dateRange" | "sinceUntil";
    extraParams?: Record<string, string>;
    params: Record<string, string | number | boolean | undefined>;
  }> = [
    { path: basePath, paramMode: "dateRange", params: buildProbeDateRangeParams() },
    { path: basePath, paramMode: "sinceUntil", params: buildProbeSinceUntilParams() },
  ];

  let lastErrorBody = "";
  for (const candidate of candidates) {
    const mergedParams = { ...candidate.params, ...(candidate.extraParams ?? {}) };
    try {
      await executeRequest(basePath, mergedParams, "public", undefined, DEFAULT_TIMEOUT_MS);
      cachedPublicContract = {
        path: candidate.path,
        paramMode: candidate.paramMode,
        extraParams: candidate.extraParams,
      };
      await logInfo("radar_public_contract_detected", cachedPublicContract);
      return cachedPublicContract;
    } catch (error) {
      if (error instanceof RadarHttpError) {
        lastErrorBody = error.responseBodyTrunc;
        const derived = deriveContractFromError(error.responseBodyTrunc);
        if (derived.paramMode && derived.paramMode !== candidate.paramMode) {
          const params = derived.paramMode === "sinceUntil" ? buildProbeSinceUntilParams() : buildProbeDateRangeParams();
          candidates.push({ path: basePath, paramMode: derived.paramMode, params });
        }
      }
    }
  }

  cachedPublicContract = {
    path: basePath,
    paramMode: "dateRange",
  };
  await logWarn("radar_public_contract_fallback", {
    endpoint: basePath,
    responseBody: truncate(lastErrorBody, RESPONSE_BODY_LIMIT),
  });
  return cachedPublicContract;
};
