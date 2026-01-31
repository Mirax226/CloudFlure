import { test, mock } from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { buildEndpointParams, DEFAULT_RADAR_ENDPOINT, RadarConfigError } from "../dist/radar/endpoints.js";
import { fetchRadarData, RadarFetchError } from "../dist/radar/fetch.js";
import { radarRequest } from "../dist/radar/client.js";

const makeAxiosError = (status, message = "error") => {
  const error = new Error(message);
  error.isAxiosError = true;
  error.response = {
    status,
    data: { success: false, errors: [{ message }] },
    headers: {},
  };
  return error;
};

const buildConfig = () => ({
  mode: "auto",
  token: "test-token",
  publicBaseUrl: "https://api.cloudflare.com/client/v4/radar",
  tokenBaseUrl: "https://api.cloudflare.com/client/v4/radar",
  timeoutMs: 1000,
  retryMax: 0,
  retryBaseDelayMs: 10,
});

test("buildEndpointParams throws on empty dateRange", () => {
  assert.throws(
    () => buildEndpointParams({ dateRange: "" }, DEFAULT_RADAR_ENDPOINT),
    (error) => error instanceof RadarConfigError
  );
});

test("auto mode falls back to token on 429", async () => {
  const calls = [];
  const mocked = mock.method(axios, "get", async (_url, options) => {
    calls.push(options);
    if (calls.length === 1) {
      throw makeAxiosError(429, "rate limited");
    }
    return {
      status: 200,
      data: {
        success: true,
        result: [{ name: "IR", value: 10 }],
      },
    };
  });

  const result = await fetchRadarData({ dateRange: "7d", limit: 5 }, buildConfig());

  assert.equal(result.source, "token");
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.headers?.Authorization, "Bearer test-token");

  mocked.mock.restore();
});

test("auto mode does not fall back on 400", async () => {
  const mocked = mock.method(axios, "get", async () => {
    throw makeAxiosError(400, "bad request");
  });

  await assert.rejects(
    () => fetchRadarData({ dateRange: "7d", limit: 5 }, buildConfig()),
    (error) => error instanceof RadarFetchError && error.code === "RADAR_BAD_REQUEST"
  );

  mocked.mock.restore();
});

test("radarRequest returns ok false when success=false", async () => {
  const mocked = mock.method(axios, "get", async () => ({
    status: 200,
    data: { success: false, result: null, errors: [{ message: "denied" }] },
  }));

  const result = await radarRequest({
    baseUrl: "https://api.cloudflare.com/client/v4/radar",
    path: "/traffic/countries",
    params: { dateRange: "7d", limit: 5 },
    timeoutMs: 1000,
    retryMax: 0,
    retryBaseDelayMs: 10,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 200);
  assert.equal(result.errors[0]?.message, "denied");

  mocked.mock.restore();
});
