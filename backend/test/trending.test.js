const test = require("node:test");
const assert = require("node:assert/strict");
const { TrendingService } = require("../dist/src/cache/trending.service.js");

function createMockValkey(execute, metaValues = [], runDelay = 0) {
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
        "hIncrBy",
        "hGetAll",
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
      run: async (operation) => {
        if (runDelay > 0)
          await new Promise((resolve) => setTimeout(resolve, runDelay));
        return operation(client);
      },
    },
  };
}

const emptyPrisma = { share: { findMany: async () => [] } };

function createService(mock, prisma = emptyPrisma) {
  return new TrendingService(mock.valkey, prisma);
}

const now = Date.now();
const recent = new Date(now - 60 * 60 * 1000).toISOString();
const old = new Date(now - 31 * 24 * 60 * 60 * 1000).toISOString();

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
    previewVersion: 1,
  });
}

test("ranks the last thirty days by total views and filters stale shares", async () => {
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

  // The union uses a per-read temporary key, never the old shared key.
  const [unionMethod, unionArgs] = mock.calls[0][0];
  assert.equal(unionMethod, "zUnionStore");
  assert.match(unionArgs[0], /^pingvin:trending:rank:/);
});

test("includes shares just inside the thirty-day window", async () => {
  const nearWindow = new Date(now - 29 * 24 * 60 * 60 * 1000).toISOString();
  const mock = createMockValkey(
    () => [1, [{ value: "recent", score: 2 }, { value: "older", score: 1 }], 1],
    [meta("recent", 2, recent), meta("older", 1, nearWindow)],
  );
  const service = createService(mock);

  const items = await service.getTrending();

  assert.deepEqual(
    items.map((item) => item.id),
    ["recent", "older"],
  );
  assert.equal(items[1].createdAt, nearWindow);
});

test("coalesces concurrent ranking reads", async () => {
  const mock = createMockValkey(
    () => [1, [{ value: "a", score: 4 }], 1],
    [meta("a", 4, recent)],
    20,
  );
  const service = createService(mock);

  const [first, second] = await Promise.all([
    service.getTrending(),
    service.getTrending(),
  ]);

  assert.deepEqual(
    first.map((item) => item.id),
    ["a"],
  );
  assert.deepEqual(
    second.map((item) => item.id),
    ["a"],
  );
  assert.equal(
    mock.calls.filter((queue) =>
      queue.some(([method]) => method === "zUnionStore"),
    ).length,
    1,
  );
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
    createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
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
  assert.equal(mock.calls[0][2][1][2].EX, 31 * 24 * 60 * 60);
  assert.equal(mock.calls[0][2][1][2].NX, true);

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
  assert.equal(stored.previewVersion, 1);
});

test("prefers a browser-playable video preview", async () => {
  const mock = createMockValkey(() => []);
  const service = createService(mock);

  await service.recordView({
    id: "share",
    name: "Share",
    createdAt: new Date(),
    views: 3,
    files: [
      { id: "avi", name: "clip.avi", size: 100 },
      { id: "mp4", name: "clip.mp4", size: 200 },
    ],
  });

  const stored = JSON.parse(mock.calls[0][2][1][1]);
  assert.equal(stored.previewFileId, "mp4");
  assert.equal(stored.previewKind, "video");
});

test("uses an image when the first video is not playable", async () => {
  const mock = createMockValkey(() => []);
  const service = createService(mock);

  await service.recordView({
    id: "share",
    name: "Share",
    createdAt: new Date(),
    views: 3,
    files: [
      { id: "avi", name: "clip.avi", size: 100 },
      { id: "image", name: "photo.jpg", size: 200 },
    ],
  });

  const stored = JSON.parse(mock.calls[0][2][1][1]);
  assert.equal(stored.previewFileId, "image");
  assert.equal(stored.previewKind, "image");
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
  assert.equal(setCall[1][2].EX, 31 * 24 * 60 * 60);

  // The enriched result is cached in-process, so a second read is cache-only.
  await service.getTrending();
  assert.equal(lookups, 1);
});

test("refreshes cached previews when the preview version changes", async () => {
  const ranked = [{ value: "a", score: 4 }];
  const oldMeta = JSON.stringify({
    id: "a",
    name: "Share a",
    previewFileId: "avi",
    previewKind: "video",
    fileCount: 2,
    size: 300,
    createdAt: recent,
    previewVersion: 0,
  });
  const prisma = {
    share: {
      findMany: async () => [
        {
          id: "a",
          name: "Share a",
          description: null,
          createdAt: new Date(recent),
          uploadLocked: true,
          removedReason: null,
          files: [
            { id: "avi", name: "clip.avi", size: "100" },
            { id: "mp4", name: "clip.mp4", size: "200" },
          ],
        },
      ],
    },
  };
  const mock = createMockValkey(
    (queue) =>
      queue.some(([method]) => method === "zRangeWithScores")
        ? [1, ranked, 1]
        : [1],
    [oldMeta],
  );
  const service = createService(mock, prisma);

  const [item] = await service.getTrending();

  assert.equal(item.previewFileId, "mp4");
  assert.equal(item.previewKind, "video");
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

test("records country views in one hourly hash", async () => {
  const mock = createMockValkey(() => []);
  const service = createService(mock);

  await service.recordView(
    {
      id: "share",
      name: "Share",
      createdAt: new Date(),
      views: 2,
      files: [{ id: "image", name: "photo.jpg" }],
    },
    "ph",
  );

  const queue = mock.calls[0];
  const geo = queue.filter(([method]) => method === "hIncrBy");
  const hour = Math.floor(Date.now() / (60 * 60 * 1000));
  assert.deepEqual(geo[0][1], [`pingvin:trending:geo:hour:${hour}`, "c:PH", 1]);
  assert.deepEqual(geo[1][1], [
    `pingvin:trending:geo:hour:${hour}`,
    "PH:share",
    1,
  ]);

  const geoExpire = queue.filter(([method]) => method === "expire").at(-1);
  assert.deepEqual(geoExpire[1], [
    `pingvin:trending:geo:hour:${hour}`,
    25 * 60 * 60,
  ]);
});

test("ignores invalid country codes", async () => {
  const mock = createMockValkey(() => []);
  const service = createService(mock);

  await service.recordView(
    {
      id: "share",
      createdAt: new Date(),
      views: 1,
      files: [{ id: "image", name: "photo.jpg" }],
    },
    "invalid",
  );

  assert.equal(
    mock.calls[0].some(([method]) => method === "hIncrBy"),
    false,
  );
});

test("counts country views even when the share cannot be ranked", async () => {
  const mock = createMockValkey(() => []);
  const service = createService(mock);
  const hour = Math.floor(Date.now() / (60 * 60 * 1000));

  await service.recordView(
    {
      id: "text-share",
      createdAt: new Date(),
      views: 1,
      files: [{ id: "note", name: "note.txt" }],
    },
    "ph",
  );

  assert.deepEqual(
    mock.calls[0].map(([method]) => method),
    ["hIncrBy", "expire"],
  );
  assert.deepEqual(mock.calls[0][0][1], [
    `pingvin:trending:geo:hour:${hour}`,
    "c:PH",
    1,
  ]);
});

test("returns the top five countries and their top shares", async () => {
  const buckets = Array.from({ length: 24 }, () => null);
  buckets[0] = {
    "c:PH": "10",
    "c:US": "5",
    "c:CA": "2",
    "c:DE": "1",
    "c:FR": "1",
    "c:XX": "9",
    "PH:a": "5",
    "PH:b": "3",
    "US:a": "4",
    "CA:c": "2",
    "DE:d": "1",
    "FR:e": "1",
    "XX:x": "9",
  };
  buckets[1] = { "PH:b": "2", "US:a": "1" };
  const mock = createMockValkey(
    () => buckets,
    [
      meta("a", 10, recent),
      meta("b", 5, recent),
      meta("c", 2, recent),
      meta("d", 1, recent),
      meta("e", 1, recent),
    ],
  );
  const service = createService(mock);

  const countries = await service.getTrendingCountries();

  assert.deepEqual(
    countries.map((item) => item.country),
    ["PH", "US", "CA", "DE", "FR"],
  );
  assert.equal(countries[0].views, 10);
  assert.deepEqual(
    countries[0].shares.map((item) => [item.id, item.views]),
    [
      ["a", 5],
      ["b", 5],
    ],
  );
  assert.equal(countries[1].views, 5);
  assert.equal(countries[1].shares[0].id, "a");
  assert.equal(countries[1].shares[0].views, 5);
  assert.equal(countries[2].shares[0].id, "c");
  assert.equal(countries[3].shares[0].id, "d");
  assert.equal(countries[4].shares[0].id, "e");
});

test("allows the same share under every country that viewed it", async () => {
  const buckets = Array.from({ length: 24 }, () => null);
  buckets[0] = {
    "c:PH": "12",
    "c:US": "10",
    "c:CA": "4",
    "PH:shared": "6",
    "PH:ph-only": "4",
    "US:shared": "7",
    "US:us-only": "2",
    "CA:ca-only": "4",
  };
  const mock = createMockValkey(
    () => buckets,
    [
      meta("shared", 7, recent),
      meta("ph-only", 4, recent),
      meta("us-only", 2, recent),
      meta("ca-only", 4, recent),
    ],
  );
  const service = createService(mock);

  const countries = await service.getTrendingCountries();
  const byCountry = Object.fromEntries(
    countries.map((country) => [
      country.country,
      country.shares.map((share) => share.id),
    ]),
  );

  assert.deepEqual(byCountry.PH, ["shared", "ph-only"]);
  assert.deepEqual(byCountry.US, ["shared", "us-only"]);
  assert.deepEqual(byCountry.CA, ["ca-only"]);
  const listed = countries.flatMap((country) =>
    country.shares.map((share) => share.id),
  );
  assert.ok(listed.length > new Set(listed).size);
});

test("uses the country code to break equal per-share view counts", async () => {
  const buckets = Array.from({ length: 24 }, () => null);
  buckets[0] = {
    "c:PH": "5",
    "c:US": "5",
    "PH:shared": "5",
    "US:shared": "5",
  };
  const mock = createMockValkey(() => buckets, [meta("shared", 5, recent)]);
  const service = createService(mock);

  const countries = await service.getTrendingCountries();

  assert.deepEqual(
    countries.map((country) => [country.country, country.shares.length]),
    [
      ["PH", 1],
      ["US", 1],
    ],
  );
  assert.equal(countries[0].shares[0].id, "shared");
  assert.equal(countries[1].shares[0].id, "shared");
});

test("skips countries without shares and backfills to five", async () => {
  const buckets = Array.from({ length: 24 }, () => null);
  buckets[0] = {
    "c:PH": "100",
    "c:US": "90",
    "c:CA": "80",
    "c:DE": "70",
    "c:FR": "60",
    "c:IT": "50",
    "US:us-only": "2",
    "CA:ca-only": "1",
    "DE:de-only": "1",
    "FR:fr-only": "1",
    "IT:it-only": "1",
  };
  const mock = createMockValkey(
    () => buckets,
    [
      meta("us-only", 2, recent),
      meta("ca-only", 1, recent),
      meta("de-only", 1, recent),
      meta("fr-only", 1, recent),
      meta("it-only", 1, recent),
    ],
  );
  const service = createService(mock);

  const countries = await service.getTrendingCountries();

  assert.deepEqual(
    countries.map((country) => country.country),
    ["US", "CA", "DE", "FR", "IT"],
  );
  assert.equal(countries.length, 5);
});

test("limits each country to ten shares", async () => {
  const buckets = Array.from({ length: 24 }, () => null);
  buckets[0] = {
    "c:PH": "1000",
    ...Object.fromEntries(
      Array.from({ length: 15 }, (_, index) => [
        `PH:s${index}`,
        String(100 - index),
      ]),
    ),
  };
  const metas = Array.from({ length: 10 }, (_, index) =>
    meta(`s${index}`, 100 - index, recent),
  );
  const mock = createMockValkey(() => buckets, metas);
  const service = createService(mock);

  const [country] = await service.getTrendingCountries();

  assert.equal(country.views, 1000);
  assert.equal(country.shares.length, 10);
  assert.equal(country.shares[0].id, "s0");
  assert.equal(country.shares.at(-1).id, "s9");
});

test("caches the country aggregate for five minutes", async () => {
  const mock = createMockValkey(() => Array.from({ length: 24 }, () => null));
  const service = createService(mock);

  assert.deepEqual(await service.getTrendingCountries(), []);
  const callsAfterFirstRead = mock.calls.length;
  assert.deepEqual(await service.getTrendingCountries(), []);
  assert.equal(mock.calls.length, callsAfterFirstRead);
});

test("drops country shares whose metadata is gone", async () => {
  const buckets = Array.from({ length: 24 }, () => null);
  buckets[0] = { "c:PH": "9", "PH:a": "5", "PH:deleted": "4" };
  const mock = createMockValkey(() => buckets, [meta("a", 5, recent), null]);
  const service = createService(mock);

  const [country] = await service.getTrendingCountries();

  assert.equal(country.views, 9);
  assert.deepEqual(
    country.shares.map((item) => item.id),
    ["a"],
  );
});
