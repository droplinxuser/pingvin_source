const test = require("node:test");
const assert = require("node:assert/strict");
const { ErrorLogService } = require("../dist/src/logs/errorLog.service.js");
const {
  ErrorTrackingLogger,
} = require("../dist/src/logs/errorTracking.logger.js");

const unavailableValkey = { run: async () => undefined };

test("keeps backend and frontend error logs separate in the memory fallback", async () => {
  const logs = new ErrorLogService(unavailableValkey);

  await logs.add("backend", {
    message: "backend boom",
    stack: "Error: backend boom\n    at handler",
    context: "TestService",
  });
  await logs.add("frontend", {
    message: "frontend boom",
    context: "window.onerror",
    url: "http://localhost/share/abc",
  });

  const backend = await logs.list("backend", 1, 20);
  assert.equal(backend.total, 1);
  assert.equal(backend.storage, "memory");
  assert.equal(backend.entries[0].message, "backend boom");
  assert.equal(backend.entries[0].context, "TestService");
  assert.equal(backend.entries[0].source, "backend");

  const frontend = await logs.list("frontend", 1, 20);
  assert.equal(frontend.total, 1);
  assert.equal(frontend.entries[0].message, "frontend boom");
  assert.equal(frontend.entries[0].context, "window.onerror");
  assert.equal(frontend.entries[0].source, "frontend");
});

test("keeps only the newest 100 entries and paginates them", async () => {
  const logs = new ErrorLogService(unavailableValkey);
  for (let index = 0; index < 105; index++)
    await logs.add("backend", { message: `error ${index}` });

  const firstPage = await logs.list("backend", 1, 100);
  assert.equal(firstPage.total, 100);
  assert.equal(firstPage.entries.length, 100);
  assert.equal(firstPage.entries[0].message, "error 104");
  assert.equal(firstPage.entries[99].message, "error 5");

  const secondPage = await logs.list("backend", 2, 20);
  assert.equal(secondPage.total, 100);
  assert.equal(secondPage.entries.length, 20);
  assert.equal(secondPage.entries[0].message, "error 84");

  const lastPage = await logs.list("backend", 6, 20);
  assert.equal(lastPage.entries.length, 0);
});

test("deduplicates repeated browser errors for one minute", async () => {
  const logs = new ErrorLogService(unavailableValkey);
  const input = { message: "same failure", context: "unhandledrejection" };

  await logs.add("frontend", input);
  await logs.add("frontend", input);

  const result = await logs.list("frontend", 1, 20);
  assert.equal(result.total, 1);
});

test("bounds stored text fields", async () => {
  const logs = new ErrorLogService(unavailableValkey);
  await logs.add("backend", { message: "x".repeat(5_000) });

  const result = await logs.list("backend", 1, 20);
  assert.equal(result.entries[0].message.length, 4_001);
  assert.ok(result.entries[0].message.endsWith("…"));
});

test("forwards error-level Nest logs to the shared store", () => {
  const captured = [];
  const logger = new ErrorTrackingLogger(
    {
      capture: (source, input) => captured.push({ source, input }),
    },
    { logLevels: ["fatal"] },
  );

  logger.error(new Error("backend boom"), undefined, "TestService");
  logger.error("plain message", "TestService");

  assert.equal(captured.length, 2);
  assert.equal(captured[0].source, "backend");
  assert.equal(captured[0].input.message.message, "backend boom");
  assert.equal(captured[0].input.context, "TestService");
  assert.equal(captured[1].input.message, "plain message");
  assert.equal(captured[1].input.context, "TestService");
});
