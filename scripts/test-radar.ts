import axios from "axios";
import { buildRadarUrl } from "../src/radar/client.js";

const endpointPath = "/traffic/countries";
const params = { limit: 10, dateRange: "7d" };
const url = buildRadarUrl(endpointPath, params);

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

const run = async (label: string, token?: string) => {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await axios.get(url, {
    headers,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    console.error(`[${label}] FAILED status=${response.status}`);
    console.error(`url=${url}`);
    console.error(`body=${formatBody(response.data)}`);
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
