const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ValkeyThrottlerStorage,
} = require("../dist/src/cache/valkeyThrottler.storage.js");

test("falls back to in-memory throttling when Valkey is disabled", async () => {
  const storage = new ValkeyThrottlerStorage(false, "");
  await storage.initialize();

  const first = await storage.increment("test-key", 60000, 2, 60000, "visitor");
  const second = await storage.increment(
    "test-key",
    60000,
    2,
    60000,
    "visitor",
  );
  const third = await storage.increment("test-key", 60000, 2, 60000, "visitor");

  assert.equal(first.isBlocked, false);
  assert.equal(second.isBlocked, false);
  assert.equal(third.isBlocked, true);
  await storage.onApplicationShutdown();
});
