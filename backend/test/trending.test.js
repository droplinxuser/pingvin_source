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

const emptyPrisma = { share: { findMany: async () => [] } };

function createService(mock, prisma = emptyPrisma) {
  return new TrendingService(mock.valkey, prisma);
}

const now = Date.now();
const recent = new Date(now - 60 * 60 * 1000).toISOString();
const old = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();

function meta(id, _views, createdAt, kind = "image") {
  return JSON.stringify({
    id,
    name: `Share ${id}`,
    description: `Description for ${id}`,
    previewFileId: `file-${id}`,
    previewKind: kind,
    fileCount: 3,
    size: 1234,
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
  const service = createService(mock);

  const items = await service.getTrending();

  assert.deepEqual(
    items.map((item) => item.id),
    ["a", "b"],
  );
  assert.equal(items[0].views, 40);
  assert.equal(items[1].views, 20);
  assert.equal(items[1].previewKind, "video");
  assert.equal(items[1].previewFileId, "file-b");
  assert.equal(items[0].description, "Description for a");
  assert.equal(items[0].fileCount, 3);
  assert.equal(items[0].size, 1234);
  assert.equal(items[0].createdAt, recent);
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
  const service = createService(mock);
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
  const service = createService(mock);
  const base = {
    id: "share",
    name: "Share",
    description: "  First line\n second line  ",
    createdAt: new Date(),
    views: 7,
  };

  await service.recordView({
    ...base,
    files: [{ id: "text", name: "note.txt", size: 10 }],
  });
  assert.equal(mock.calls.length, 0);

  await service.recordView({
    ...base,
    createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    files: [{ id: "image", name: "photo.jpg", size: 10 }],
  });
  assert.equal(mock.calls.length, 0);

  await service.recordView({
    ...base,
    files: [
      { id: "video", name: "clip.mp4", size: 1200 },
      { id: "image", name: "photo.jpg", size: 3400 },
    ],
  });
  assert.equal(mock.calls.length, 1);

  const methods = mock.calls[0].map(([method]) => method);
  assert.deepEqual(methods, ["zAdd", "expire", "set"]);
  assert.deepEqual(mock.calls[0][0][1][1], { score: 7, value: "share" });
  assert.equal(mock.calls[0][2][1][2].EX, 8 * 24 * 60 * 60);

  const stored = JSON.parse(mock.calls[0][2][1][1]);
  assert.equal(stored.previewFileId, "video");
  assert.equal(stored.previewKind, "video");
  assert.equal(stored.description, "First line second line");
  assert.equal(stored.fileCount, 2);
  assert.equal(stored.size, 4600);
  assert.equal("views" in stored, false);
});

test("stores compact metadata and truncates long descriptions", async () => {
  const mock = createMockValkey(() => []);
  const service = createService(mock);

  await service.recordView({
    id: "share",
    name: "Share",
    description: `  First\nline   ${"x".repeat(400)}  `,
    createdAt: new Date(),
    views: 3,
    files: [
      { id: "image", name: "photo.jpg", size: "1234" },
      { id: "video", name: "clip.mp4", size: "3400" },
    ],
  });

  const stored = JSON.parse(mock.calls[0][2][1][1]);
  assert.equal(stored.description.length, 240);
  assert.equal(stored.description.startsWith("First line xxx"), true);
  assert.equal(stored.fileCount, 2);
  assert.equal(stored.size, 4634);
});

test("backfills legacy metadata from SQLite once", async () => {
  const ranked = [{ value: "a", score: 4 }];
  const legacy = JSON.stringify({
    id: "a",
    name: "Share a",
    previewFileId: "file-a",
    previewKind: "image",
    createdAt: recent,
  });
  let lookups = 0;
  const prisma = {
    share: {
      findMany: async ({ where }) => {
        lookups += 1;
        assert.deepEqual(where.id.in, ["a"]);
        return [
          {
            id: "a",
            name: "Share a",
            description: "  Hello\nworld ",
            createdAt: new Date(recent),
            uploadLocked: true,
            removedReason: null,
            files: [
              { id: "file-a", name: "photo.jpg", size: "1500" },
              { id: "note", name: "note.txt", size: "25" },
            ],
          },
        ];
      },
    },
  };
  const mock = createMockValkey(
    (queue) =>
      queue.some(([method]) => method === "zRangeWithScores")
        ? [1, ranked, 1]
        : [1],
    [legacy],
  );
  const service = createService(mock, prisma);

  const [item] = await service.getTrending();
  assert.equal(item.id, "a");
  assert.equal(item.name, "Share a");
  assert.equal(item.description, "Hello world");
  assert.equal(item.fileCount, 2);
  assert.equal(item.size, 1525);
  assert.equal(item.createdAt, recent);
  assert.equal(lookups, 1);

  const setCall = mock.calls
    .flat()
    .find(
      ([method, args]) =>
        method === "set" && args[0] === "pingvin:trending:meta:a",
    );
  assert.ok(setCall);
  assert.equal(JSON.parse(setCall[1][1]).fileCount, 2);
  assert.equal(setCall[1][2].EX, 8 * 24 * 60 * 60);

  // The enriched result is cached in-process, so a second read is cache-only.
  await service.getTrending();
  assert.equal(lookups, 1);
});

test("keeps legacy metadata readable when the backfill query fails", async () => {
  const legacy = JSON.stringify({
    id: "a",
    name: "Share a",
    previewFileId: "file-a",
    previewKind: "image",
    createdAt: recent,
  });
  const prisma = {
    share: {
      findMany: async () => {
        throw new Error("database unavailable");
      },
    },
  };
  const mock = createMockValkey(
    () => [1, [{ value: "a", score: 4 }], 1],
    [legacy],
  );
  const service = createService(mock, prisma);

  const [item] = await service.getTrending();
  assert.equal(item.id, "a");
  assert.equal(item.createdAt, recent);
  assert.equal(item.description, undefined);
  assert.equal(item.fileCount, 0);
  assert.equal(item.size, 0);
});

test("drops metadata for shares that no longer exist", async () => {
  const legacy = JSON.stringify({
    id: "a",
    name: "Share a",
    previewFileId: "file-a",
    previewKind: "image",
    createdAt: recent,
  });
  const mock = createMockValkey(
    () => [1, [{ value: "a", score: 4 }], 1],
    [legacy],
  );
  const service = createService(mock);

  assert.deepEqual(await service.getTrending(), []);
  const delCall = mock.calls
    .flat()
    .find(
      ([method, args]) =>
        method === "del" && args[0] === "pingvin:trending:meta:a",
    );
  assert.ok(delCall);
});

test("keeps the short ranking cache between views", async () => {
  const mock = createMockValkey(
    () => [1, [{ value: "a", score: 1 }], 1],
    [meta("a", 1, recent)],
  );
  const service = createService(mock);

  assert.deepEqual(
    (await service.getTrending()).map((item) => item.id),
    ["a"],
  );
  const callsAfterFirstRead = mock.calls.length;

  await service.recordView({
    id: "a",
    name: "Share a",
    createdAt: new Date(),
    views: 2,
    files: [{ id: "image-a", name: "photo.jpg" }],
  });
  assert.deepEqual(
    (await service.getTrending()).map((item) => item.id),
    ["a"],
  );

  // Only the recordView MULTI reached Valkey; the second read came from the
  // 30-second in-process result cache.
  assert.equal(mock.calls.length, callsAfterFirstRead + 1);
});

test("invalidates cached rankings and share metadata", async () => {
  const mock = createMockValkey(
    () => [1, [{ value: "a", score: 1 }], 1],
    [meta("a", 1, recent)],
  );
  const service = createService(mock);
  assert.deepEqual(
    (await service.getTrending()).map((item) => item.id),
    ["a"],
  );

  await service.invalidate("a");

  const calls = mock.calls.map((queue) => queue.map(([method]) => method));
  assert.deepEqual(calls.at(-1), ["del"]);
  assert.deepEqual(mock.calls.at(-1)[0][1], ["pingvin:trending:meta:a"]);
});
