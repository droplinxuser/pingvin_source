const test = require("node:test");
const assert = require("node:assert/strict");
const { DownloadService } = require("../dist/src/cache/download.service.js");

// Minimal in-memory stand-in for the node-redis client used by ValkeyService.
function createMockValkey({ enabled = true } = {}) {
  const hashes = new Map();
  const sortedSets = new Map();
  const strings = new Map();
  const client = {
    multi() {
      const queue = [];
      const chain = {};
      for (const method of [
        "hIncrBy",
        "expire",
        "hGetAll",
        "zIncrBy",
        "incr",
        "zRemRangeByRank",
      ]) {
        chain[method] = (...args) => {
          queue.push([method, args]);
          return chain;
        };
      }
      chain.exec = async () => {
        const out = [];
        for (const [method, args] of queue) {
          if (method === "hIncrBy") {
            const [key, field, by] = args;
            const hash = hashes.get(key) ?? new Map();
            hash.set(field, (hash.get(field) ?? 0) + by);
            hashes.set(key, hash);
            out.push(hash.get(field));
          } else if (method === "zIncrBy") {
            const [key, by, member] = args;
            const sorted = sortedSets.get(key) ?? new Map();
            sorted.set(member, (sorted.get(member) ?? 0) + by);
            sortedSets.set(key, sorted);
            out.push(sorted.get(member));
          } else if (method === "incr") {
            const key = args[0];
            const next = (strings.get(key) ?? 0) + 1;
            strings.set(key, next);
            out.push(next);
          } else if (method === "hGetAll") {
            const hash = hashes.get(args[0]);
            out.push(
              hash
                ? Object.fromEntries(
                    [...hash].map(([field, value]) => [field, String(value)]),
                  )
                : {},
            );
          } else {
            out.push(1);
          }
        }
        return out;
      };
      return chain;
    },
    async zRangeWithScores(key, start, stop) {
      const sorted = sortedSets.get(key) ?? new Map();
      return [...sorted.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(start, stop + 1)
        .map(([value, score]) => ({ value, score: String(score) }));
    },
    async get(key) {
      return strings.has(key) ? String(strings.get(key)) : null;
    },
  };

  return {
    hashes,
    sortedSets,
    strings,
    valkey: {
      run: async (operation) => (enabled ? operation(client) : undefined),
    },
  };
}

test("counts share and per-file downloads in Valkey", async () => {
  const mock = createMockValkey();
  const service = new DownloadService(mock.valkey);

  await service.recordDownload("share-1", ["file-a"]);
  await service.recordDownload("share-1", ["file-b"]);
  await service.recordDownload("share-1", ["file-b"]);

  const stats = await service.getShareDownloads("share-1");
  assert.equal(stats.total, 3);
  assert.equal(stats.files["file-a"], 1);
  assert.equal(stats.files["file-b"], 2);
  // One small per-share, per-day hash, never a global one.
  assert.equal(mock.hashes.size, 1);
  assert.match(
    [...mock.hashes.keys()][0],
    /^pingvin:downloads:day:\d+:share-1$/,
  );
  // The 24-hour tie-break uses one hourly sorted set for all shares, plus the
  // all-time ranking set used by /stats.
  assert.equal(mock.sortedSets.size, 2);
  const hourKey = [...mock.sortedSets.keys()].find((key) =>
    key.startsWith("pingvin:downloads:hour:"),
  );
  const rankKey = [...mock.sortedSets.keys()].find(
    (key) => key === "pingvin:downloads:shares:all",
  );
  assert.match(hourKey, /^pingvin:downloads:hour:\d+$/);
  assert.equal(mock.sortedSets.get(hourKey).get("share-1"), 3);
  assert.equal(mock.sortedSets.get(rankKey).get("share-1"), 3);
  assert.equal(await service.getTotalDownloads(), 3);
  assert.deepEqual(await service.getTopShares(20), [
    { shareId: "share-1", downloads: 3 },
  ]);
});

test("keeps each share's counters isolated", async () => {
  const mock = createMockValkey();
  const service = new DownloadService(mock.valkey);

  await service.recordDownload("share-1", ["file-a"]);
  await service.recordDownload("share-2", ["file-c"]);

  assert.deepEqual(await service.getShareDownloads("share-1"), {
    total: 1,
    files: { "file-a": 1 },
  });
  assert.deepEqual(await service.getShareDownloads("share-2"), {
    total: 1,
    files: { "file-c": 1 },
  });
});

test("falls back to an in-process counter when Valkey is unavailable", async () => {
  const mock = createMockValkey({ enabled: false });
  const service = new DownloadService(mock.valkey);

  await service.recordDownload("share-1", ["file-a"]);
  await service.recordDownload("share-1", ["file-a"]);

  assert.deepEqual(await service.getShareDownloads("share-1"), {
    total: 2,
    files: { "file-a": 2 },
  });
  assert.equal(await service.getTotalDownloads(), 2);
  assert.deepEqual(await service.getTopShares(20), [
    { shareId: "share-1", downloads: 2 },
  ]);
});

test("reports zeros for a share with no downloads", async () => {
  const mock = createMockValkey();
  const service = new DownloadService(mock.valkey);

  assert.deepEqual(await service.getShareDownloads("unknown"), {
    total: 0,
    files: {},
  });
});
