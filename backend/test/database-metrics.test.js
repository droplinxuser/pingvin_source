const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildDatabaseMetrics,
  emptyDatabaseMetrics,
} = require("../dist/src/utils/sqlite.util.js");

test("computes fragmentation from free and total pages", () => {
  const metrics = buildDatabaseMetrics({
    file: "/data/pingvin-share.db",
    sizeBytes: 40_960,
    walSizeBytes: 8_192,
    shmSizeBytes: 32_768,
    pageSize: 4096,
    pageCount: 10,
    freePages: 3,
    journalMode: "wal",
    version: "3.45.0",
  });

  assert.equal(metrics.configured, true);
  assert.equal(metrics.pageCount, 10);
  assert.equal(metrics.fragmentation, 0.3);
  assert.equal(metrics.journalMode, "wal");
});

test("fragmentation is null when the page count is unknown", () => {
  const metrics = buildDatabaseMetrics({
    file: null,
    sizeBytes: null,
    walSizeBytes: null,
    shmSizeBytes: null,
    pageSize: null,
    pageCount: null,
    freePages: null,
    journalMode: null,
    version: null,
  });
  assert.equal(metrics.fragmentation, null);
});

test("empty metrics report the failure detail", () => {
  const metrics = emptyDatabaseMetrics("no such table");
  assert.equal(metrics.configured, false);
  assert.equal(metrics.detail, "no such table");
  assert.equal(metrics.sizeBytes, null);
});
