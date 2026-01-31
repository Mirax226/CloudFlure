import { test } from "node:test";
import assert from "node:assert/strict";
import { getSchedulerBackoffMinutes } from "../dist/scheduler/backoff.js";

test("scheduler backoff caps at 60 minutes", () => {
  assert.equal(getSchedulerBackoffMinutes(1), 2);
  assert.equal(getSchedulerBackoffMinutes(2), 4);
  assert.equal(getSchedulerBackoffMinutes(5), 32);
  assert.equal(getSchedulerBackoffMinutes(8), 60);
});
