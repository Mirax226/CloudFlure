import axios from "axios";
import { buildRadarUrl } from "../src/radar/client.js";

type RadarResponse = { success?: boolean; result?: unknown };

const params = { dateRange: "7d", limit: 10 };
const endpoint = "/traffic/countries";

const buildHeaders = (token?: string): Record<string, string> => {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
};

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

const printResult = (label: string, url: string, status: number, payload: RadarResponse) => {
  const resultKeys = payload && typeof payload.result === "object" && payload.result !== null
    ? Object.keys(payload.result as Record<string, unknown>).slice(0, 5)
    : [];
  console.log(`[${label}] finalUrl=${url}`);
  console.log(`[${label}] status=${status}`);
  console.log(`[${label}] success=${String(payload.success)}`);
  console.log(`[${label}] resultKeys=${resultKeys.join(",") || "none"}`);
};

const runCall = async (label: string, token?: string): Promise<void> => {
  const url = buildRadarUrl(endpoint, params);
  const response = await axios.get(url, {
    headers: buildHeaders(token),
    validateStatus: () => true,
  });

  const payload = response.data as RadarResponse;
  printResult(label, url, response.status, payload);

  if (response.status < 200 || response.status >= 300) {
    console.error(`[${label}] body=${formatBody(response.data)}`);
    process.exitCode = 1;
    return;
  }
  if (payload?.success !== true) {
    console.error(`[${label}] invalid_success body=${formatBody(response.data)}`);
    process.exitCode = 1;
    return;
  }
  if (payload.result === null || payload.result === undefined) {
    console.error(`[${label}] missing_result body=${formatBody(response.data)}`);
    process.exitCode = 1;
  }
};

const run = async (): Promise<void> => {
  await runCall("public");

  const token = process.env.RADAR_API_TOKEN?.trim();
  if (token) {
    await runCall("token", token);
  }
};

run().catch((error) => {
  console.error("radar_smoke_failed", error);
  process.exitCode = 1;
});
