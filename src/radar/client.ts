import axios from "axios";
import { logInfo, logWarn } from "../logger.js";

export const CF_API_BASE = "https://api.cloudflare.com/client/v4";
export const RADAR_BASE = `${CF_API_BASE}/radar`;

export type RadarAuthMode = "public" | "token" | "auto";

export type RadarRequestMeta = {
  url: string;
  status: number;
  modeUsed: "public" | "token";
};

export class RadarHttpError extends Error {
  status: number;
  url: string;
  path: string;
  params: Record<string, string | number | boolean | undefined>;
  modeAttempted: "public" | "token";
  responseBody: string;

  constructor(message: string, details: Omit<RadarHttpError, "name" | "message">) {
    super(message);
    this.name = "RadarHttpError";
    this.status = details.status;
    this.url = details.url;
    this.path = details.path;
    this.params = details.params;
    this.modeAttempted = details.modeAttempted;
    this.responseBody = details.responseBody;
  }
}

const USER_AGENT = "CloudFlureBot/2.0";
const RESPONSE_BODY_LIMIT = 2000;
const DEFAULT_TIMEOUT_MS = 15_000;

const truncate = (value: string, maxChars: number) => (value.length > maxChars ? `${value.slice(0, maxChars)}…` : value);

export const buildUrl = (
  path: string,
  params: Record<string, string | number | boolean | undefined>
): string => {
  const url = new URL(path.replace(/^\//, ""), `${RADAR_BASE}/`);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined) {
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
  params: Record<string, string | number | boolean | undefined>,
  modeUsed: "public" | "token",
  token: string | undefined,
  timeoutMs: number
): Promise<{ data: T; meta: RadarRequestMeta }> => {
  const url = buildUrl(path, params);
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
      modeAttempted: modeUsed,
      responseBody: truncate(responseBody, RESPONSE_BODY_LIMIT),
    });
  }
  return { data: response.data as T, meta: { url, status, modeUsed } };
};

const isFallbackStatus = (status: number): boolean => [400, 401, 403, 404].includes(status);

export const requestRadar = async <T>(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  mode: RadarAuthMode,
  token?: string,
  options?: { timeoutMs?: number }
): Promise<{ data: T; meta: RadarRequestMeta }> => {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (mode === "public") {
    return executeRequest<T>(path, params, "public", undefined, timeoutMs);
  }

  if (mode === "token") {
    return executeRequest<T>(path, params, "token", token, timeoutMs);
  }

  if (token) {
    try {
      return await executeRequest<T>(path, params, "token", token, timeoutMs);
    } catch (error) {
      if (error instanceof RadarHttpError) {
        if (isFallbackStatus(error.status)) {
          await logWarn("radar_auto_token_fallback_public", {
            status: error.status,
            endpoint: path,
            params,
            modeUsed: "token",
          });
          return executeRequest<T>(path, params, "public", undefined, timeoutMs);
        }
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

  const basePath = "/traffic/countries";
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
        lastErrorBody = error.responseBody;
        const derived = deriveContractFromError(error.responseBody);
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
