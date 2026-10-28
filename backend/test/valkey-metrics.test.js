const test = require("node:test");
const assert = require("node:assert/strict");
const {
  emptyValkeyMetrics,
  parseValkeyInfo,
} = require("../dist/src/cache/valkeyMetrics.util.js");

test("parses the Valkey INFO fields used by the admin card", () => {
  const metrics = parseValkeyInfo(`
# Server
redis_version:7.2.5
uptime_in_seconds:3600
# Clients
connected_clients:3
# Memory
used_memory:1048576
used_memory_peak:2097152
# Stats
keyspace_hits:75
keyspace_misses:25
# Keyspace
db0:keys=10,expires=2,avg_ttl=0
db1:keys=5,expires=0,avg_ttl=0
`);

  assert.equal(metrics.configured, true);
  assert.equal(metrics.connected, true);
  assert.equal(metrics.version, "7.2.5");
  assert.equal(metrics.uptimeSeconds, 3600);
  assert.equal(metrics.memoryUsedBytes, 1048576);
  assert.equal(metrics.memoryPeakBytes, 2097152);
  assert.equal(metrics.totalKeys, 15);
  assert.equal(metrics.hits, 75);
  assert.equal(metrics.misses, 25);
  assert.equal(metrics.hitRatio, 0.75);
  assert.equal(metrics.connectedClients, 3);
});

test("describes an unavailable Valkey without inventing values", () => {
  assert.deepEqual(emptyValkeyMetrics(false), {
    configured: false,
    connected: false,
    version: null,
    uptimeSeconds: null,
    memoryUsedBytes: null,
    memoryPeakBytes: null,
    totalKeys: null,
    hits: null,
    misses: null,
    hitRatio: null,
    connectedClients: null,
  });
});
