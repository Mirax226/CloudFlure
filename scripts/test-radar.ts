import axios from "axios";
import { buildRadarUrl } from "../src/radar/client.js";
import { DEFAULT_RADAR_ENDPOINT } from "../src/radar/endpoints.js";

const params = { limit: 10, dateRange: "7d" };

const formatBody = (data: unknown): string => {
  if (typeof data === "string") {
    return data;
  }
  try {
    return JSON.stringify(data ?? "");
  } catch {
    return String(data);
  }
};

const resolveBaseUrl = (mode: "public" | "token"): string | undefined => {
  const envKey = mode === "public" ? "RADAR_PUBLIC_BASE_URL" : "RADAR_TOKEN_BASE_URL";
  return process.env[envKey]?.trim() || undefined;
};

const isRouteInvalid = (body: string): boolean => {
  if (body.includes("No route for that URI")) {
    return true;
  }
  try {
    const parsed = JSON.parse(body) as { errors?: { message?: string }[] };
    return parsed?.errors?.some((item) => item?.message?.includes("No route for that URI")) ?? false;
  } catch {
    return false;
  }
};

const run = async (label: string, token?: string) => {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const baseUrl = resolveBaseUrl(token ? "token" : "public");
  const url = buildRadarUrl(DEFAULT_RADAR_ENDPOINT.path, params, baseUrl);
  const response = await axios.get(url, {
    headers,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    const bodyText = formatBody(response.data);
    console.error(`[${label}] FAILED status=${response.status}`);
    console.error(`url=${url}`);
    console.error(`body=${bodyText}`);
    if (isRouteInvalid(bodyText)) {
      process.exitCode = 2;
      return;
    }
    process.exitCode = 1;
    return;
  }

  console.log(`[${label}] OK status=${response.status}`);
};

const runAll = async () => {
  await run("public");

  const token = process.env.RADAR_API_TOKEN?.trim();
  if (token) {
    await run("token", token);
  }
};

runAll().catch((error) => {
  console.error("radar_test_failed", error);
  process.exitCode = 1;
});
