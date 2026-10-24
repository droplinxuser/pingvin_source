const test = require("node:test");
const assert = require("node:assert/strict");
const { TrendingService } = require("../dist/src/cache/trending.service.js");

function createMockValkey(execute, metaValues = []) {
  const calls = [];
  const client = {
    mGet: async () => metaValues,
    multi() {
      const queue = [];
      const chain = {};
      for (const method of [
        "zAdd",
        "expire",
        "set",
        "del",
        "zUnionStore",
        "zRangeWithScores",
      ]) {
        chain[method] = (...args) => {
          queue.push([method, args]);
          return chain;
        };
      }
      chain.exec = async () => {
        calls.push(queue);
        return execute(queue);
      };
      return chain;
    },
  };

  return {
    calls,
    valkey: {
      run: async (operation) => operation(client),
    },
  };
}

const now = Date.now();
const recent = new Date(now - 60 * 60 * 1000).toISOString();
const old = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();

function meta(id, views, createdAt, kind = "image") {
  return JSON.stringify({
    id,
    name: `Share ${id}`,
    views,
    previewFileId: `file-${id}`,
    previewKind: kind,
    createdAt,
  });
}

test("ranks the last seven days by total views and filters stale shares", async () => {
  const ranked = [
    { value: "a", score: 40 },
    { value: "old", score: 30 },
    { value: "b", score: 20 },
    { value: "broken", score: 10 },
  ];
  const mock = createMockValkey(
    () => [1, ranked, 1],
    [
      meta("a", 400, recent),
      meta("old", 300, old),
      meta("b", 200, recent, "video"),
      null,
    ],
  );
  const service = new TrendingService(mock.valkey);

  const items = await service.getTrending();

  assert.deepEqual(
    items.map((item) => item.id),
    ["a", "b"],
  );
  assert.equal(items[0].views, 400);
  assert.equal(items[1].previewKind, "video");
  assert.equal(items[1].previewFileId, "file-b");
});

test("returns twelve by default and caps the full list at forty-eight", async () => {
  const ranked = Array.from({ length: 50 }, (_, index) => ({
    value: `s${index}`,
    score: 100 - index,
  }));
  const metas = Array.from({ length: 50 }, (_, index) =>
    meta(`s${index}`, 100 - index, recent),
  );

  const mock = createMockValkey(() => [1, ranked, 1], metas);
  const service = new TrendingService(mock.valkey);
  const items = await service.getTrending();

  assert.equal(items.length, 12);
  assert.deepEqual(
    items.map((item) => item.id),
    Array.from({ length: 12 }, (_, index) => `s${index}`),
  );

  const expanded = await service.getTrending(48);
  assert.equal(expanded.length, 48);
  assert.equal(expanded.at(-1).id, "s47");

  const capped = await service.getTrending(100);
  assert.equal(capped.length, 48);
});

test("records only recent public shares with image or video media", async () => {
  const mock = createMockValkey(() => []);
  const service = new TrendingService(mock.valkey);
  const base = {
    id: "share",
    name: "Share",
    createdAt: new Date(),
    views: 7,
  };

  await service.recordView({
    ...base,
    files: [{ id: "text", name: "note.txt" }],
  });
  assert.equal(mock.calls.length, 0);

  await service.recordView({
    ...base,
    createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    files: [{ id: "image", name: "photo.jpg" }],
  });
  assert.equal(mock.calls.length, 0);

  await service.recordView({
    ...base,
    files: [
      { id: "video", name: "clip.mp4" },
      { id: "image", name: "photo.jpg" },
    ],
  });
  assert.equal(mock.calls.length, 1);

  const methods = mock.calls[0].map(([method]) => method);
  assert.deepEqual(methods, ["zAdd", "expire", "set"]);
  assert.deepEqual(mock.calls[0][0][1][1], { score: 7, value: "share" });

  const stored = JSON.parse(mock.calls[0][2][1][1]);
  assert.equal(stored.previewFileId, "video");
  assert.equal(stored.previewKind, "video");
  assert.equal(stored.views, 7);
});

test("invalidates cached rankings and share metadata", async () => {
  const mock = createMockValkey(() => [1, [{ value: "a", score: 1 }], 1], [
    meta("a", 1, recent),
  ]);
  const service = new TrendingService(mock.valkey);
  assert.deepEqual(
    (await service.getTrending()).map((item) => item.id),
    ["a"],
  );

  await service.invalidate("a");

  const calls = mock.calls.map((queue) => queue.map(([method]) => method));
  assert.deepEqual(calls.at(-1), ["del"]);
  assert.deepEqual(mock.calls.at(-1)[0][1], ["pingvin:trending:meta:a"]);
});
