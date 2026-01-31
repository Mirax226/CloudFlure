import { test, mock } from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { buildEndpointParams, DEFAULT_RADAR_ENDPOINT, RadarConfigError } from "../dist/radar/endpoints.js";
import { fetchRadarData, RadarFetchError } from "../dist/radar/fetch.js";
import { requestRadar } from "../dist/radar/client.js";
import { rangePresetToApiParams } from "../dist/radar/dateRange.js";

const buildConfig = () => ({
  mode: "auto",
  token: "test-token-123456789012345",
  timeoutMs: 1000,
  dateRangePreset: "D7",
});

test("buildEndpointParams throws on empty dateRange", () => {
  assert.throws(
    () => buildEndpointParams({ dateRange: "" }, DEFAULT_RADAR_ENDPOINT),
    (error) => error instanceof RadarConfigError
  );
});

test("auto mode falls back to public on 400", async () => {
  const calls = [];
  const mocked = mock.method(axios, "get", async (_url, options) => {
    calls.push(options);
    if (calls.length === 1) {
      return {
        status: 400,
        data: { errors: [{ message: "bad request" }] },
      };
    }
    return {
      status: 200,
      data: {
        success: true,
        result: [{ name: "IR", value: 10 }],
      },
    };
  });

  const result = await fetchRadarData({ limit: 5 }, buildConfig());

  assert.equal(result.source, "public");
  assert.equal(calls.length, 2);

  mocked.mock.restore();
});

test("auto mode does not fall back on 429", async () => {
  const mocked = mock.method(axios, "get", async () => {
    return {
      status: 429,
      data: { errors: [{ message: "rate limited" }] },
    };
  });

  await assert.rejects(
    () => fetchRadarData({ limit: 5 }, buildConfig()),
    (error) => error instanceof RadarFetchError && error.code === "RADAR_RATE_LIMIT"
  );

  mocked.mock.restore();
});

test("requestRadar returns data for public mode", async () => {
  const mocked = mock.method(axios, "get", async () => ({
    status: 200,
    data: { success: true, result: [{ name: "IR", value: 10 }] },
  }));

  const result = await requestRadar("/traffic/countries", { dateRange: "7d", limit: 5 }, "public");
  assert.equal(result.meta.status, 200);
  assert.equal(result.meta.modeUsed, "public");
  assert.ok(result.data.success);

  mocked.mock.restore();
});

test("rangePresetToApiParams returns fallback for month presets", () => {
  const now = new Date("2024-04-01T00:00:00.000Z");
  const result = rangePresetToApiParams("M1", now);
  assert.ok(result.primary.since);
  assert.ok(result.primary.until);
  assert.equal(result.fallback.dateRange, "30d");
});
