const test = require("node:test");
const assert = require("node:assert/strict");
const { TrendingService } = require("../dist/src/cache/trending.service.js");

function createMockValkey(execute) {
  const calls = [];
  const client = {
    multi() {
      const queue = [];
      const chain = {};
      for (const method of [
        "zIncrBy",
        "expire",
        "hSet",
        "hDel",
        "zUnionStore",
        "zRangeWithScores",
        "del",
        "hmGet",
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
const old = new Date(now - 49 * 60 * 60 * 1000).toISOString();

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

test("ranks the last 24h views and filters stale shares", async () => {
  const ranked = [
    { value: "a", score: 40 },
    { value: "old", score: 30 },
    { value: "b", score: 20 },
    { value: "broken", score: 10 },
  ];
  const today = [meta("a", 400, recent), null];
  const yesterday = [meta("old", 300, old), meta("b", 200, recent, "video")];

  const mock = createMockValkey((queue) =>
    queue[0][0] === "zUnionStore" ? [1, ranked, 1] : [today, yesterday],
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
    createdAt: new Date(Date.now() - 49 * 60 * 60 * 1000),
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
  assert.deepEqual(methods, ["zIncrBy", "expire", "hSet", "expire"]);

  const stored = JSON.parse(mock.calls[0][2][1][2]);
  assert.equal(stored.previewFileId, "video");
  assert.equal(stored.previewKind, "video");
  assert.equal(stored.views, 7);
});

test("invalidates cached rankings and share metadata", async () => {
  const mock = createMockValkey((queue) =>
    queue[0][0] === "zUnionStore"
      ? [1, [{ value: "a", score: 1 }], 1]
      : [[meta("a", 1, recent)], [null]],
  );
  const service = new TrendingService(mock.valkey);
  assert.deepEqual(
    (await service.getTrending()).map((item) => item.id),
    ["a"],
  );

  await service.invalidate("a");

  const calls = mock.calls.map((queue) => queue.map(([method]) => method));
  assert.deepEqual(calls.at(-1), ["hDel", "hDel"]);
});
