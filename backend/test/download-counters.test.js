const test = require("node:test");
const assert = require("node:assert/strict");
const { DownloadService } = require("../dist/src/cache/download.service.js");

// Minimal in-memory stand-in for the node-redis client used by ValkeyService.
function createMockValkey({ enabled = true } = {}) {
  const hashes = new Map();
  const sortedSets = new Map();
  const client = {
    multi() {
      const queue = [];
      const chain = {};
      for (const method of ["hIncrBy", "expire", "hGetAll", "zIncrBy"]) {
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
  };

  return {
    hashes,
    sortedSets,
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
  // The 24-hour tie-break uses one hourly sorted set for all shares.
  assert.equal(mock.sortedSets.size, 1);
  const [hourKey, scores] = [...mock.sortedSets.entries()][0];
  assert.match(hourKey, /^pingvin:downloads:hour:\d+$/);
  assert.equal(scores.get("share-1"), 3);
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
});

test("reports zeros for a share with no downloads", async () => {
  const mock = createMockValkey();
  const service = new DownloadService(mock.valkey);

  assert.deepEqual(await service.getShareDownloads("unknown"), {
    total: 0,
    files: {},
  });
});
