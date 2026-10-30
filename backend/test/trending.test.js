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
        "zIncrBy",
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

// Reply shape for the ranking read: view union, view range, download union,
// download range, then the two DELs.
function readReplies(ranked, downloads = []) {
  return [1, ranked, 1, downloads, 1, 1];
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
    updatedAt: createdAt,
    hasVideo: kind === "video",
    previewVersion: 2,
  });
}

test("ranks the last 24 hours by views and filters stale shares", async () => {
  const ranked = [
    { value: "a", score: 40 },
    { value: "old", score: 30 },
    { value: "b", score: 20 },
    { value: "broken", score: 10 },
  ];
  const mock = createMockValkey(
    () => readReplies(ranked),
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

  // The view union sums 24 hourly buckets into a per-read temporary key.
  const [unionMethod, unionArgs] = mock.calls[0][0];
  assert.equal(unionMethod, "zUnionStore");
  assert.match(unionArgs[0], /^pingvin:trending:rank:/);
  assert.equal(unionArgs[1].length, 24);
  assert.equal(unionArgs[2].AGGREGATE, "SUM");
});

test("uses 24-hour downloads as the tie-break", async () => {
  const ranked = [
    { value: "a", score: 10 },
    { value: "b", score: 10 },
    { value: "c", score: 5 },
  ];
  const downloads = [
    { value: "a", score: 1 },
    { value: "b", score: 4 },
  ];
  const mock = createMockValkey(
    () => readReplies(ranked, downloads),
    [meta("a", 10, recent), meta("b", 10, recent), meta("c", 5, recent)],
  );
  const service = createService(mock);

  const items = await service.getTrending();

  assert.deepEqual(
    items.map((item) => item.id),
    ["b", "a", "c"],
  );
  assert.equal(items[0].views, 10);
});

test("does not seed the 24-hour ranking from SQLite", async () => {
  let lookups = 0;
  const prisma = {
    share: {
      findMany: async () => {
        lookups += 1;
        return [];
      },
    },
  };
  const mock = createMockValkey(
    () => readReplies([{ value: "a", score: 3 }]),
    [meta("a", 3, recent)],
  );
  const service = createService(mock, prisma);

  assert.deepEqual(
    (await service.getTrending()).map((item) => item.id),
    ["a"],
  );
  // The 24-hour window cannot be reconstructed from cumulative SQLite views.
  assert.equal(lookups, 0);
});

test("returns twelve by default and caps the full list at two hundred", async () => {
  const ranked = Array.from({ length: 120 }, (_, index) => ({
    value: `s${index}`,
    score: 200 - index,
  }));
  const metas = Array.from({ length: 120 }, (_, index) =>
    meta(`s${index}`, 200 - index, recent),
  );

  const mock = createMockValkey(() => readReplies(ranked), metas);
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

  const capped = await service.getTrending(1000);
  assert.equal(capped.length, 120);
  assert.equal(capped.at(-1).id, "s119");
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
  assert.deepEqual(methods, ["zIncrBy", "expire", "set"]);
  const hour = Math.floor(Date.now() / (60 * 60 * 1000));
  assert.deepEqual(mock.calls[0][0][1], [
    `pingvin:trending:views:hour:${hour}`,
    1,
    "share",
  ]);
  assert.deepEqual(mock.calls[0][1][1], [
    `pingvin:trending:views:hour:${hour}`,
    25 * 60 * 60,
  ]);
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
  assert.equal(stored.previewVersion, 2);
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

test("drops metadata for shares that no longer exist", async () => {
  const legacy = JSON.stringify({
    id: "a",
    name: "Share a",
    previewFileId: "file-a",
    previewKind: "image",
    createdAt: recent,
  });
  const mock = createMockValkey(
    () => readReplies([{ value: "a", score: 4 }]),
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
    () => readReplies([{ value: "a", score: 1 }]),
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
  // 60-second in-process result cache.
  assert.equal(mock.calls.length, callsAfterFirstRead + 1);
});

test("invalidates cached rankings and share metadata", async () => {
  const mock = createMockValkey(
    () => readReplies([{ value: "a", score: 1 }]),
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

test("returns the ranked countries and their top shares", async () => {
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

test("keeps country panels filled when cached shares disappear", async () => {
  const buckets = Array.from({ length: 24 }, () => null);
  const gone = Array.from({ length: 10 }, (_, index) => `gone-${index}`);
  const live = Array.from({ length: 12 }, (_, index) => `live-${index}`);
  buckets[0] = {
    "c:PH": "100",
    ...Object.fromEntries(
      gone.map((id, index) => [`PH:${id}`, String(90 - index)]),
    ),
    ...Object.fromEntries(
      live.map((id, index) => [`PH:${id}`, String(12 - index)]),
    ),
  };
  // Only the live shares still have metadata; the deleted ones leave their
  // higher scores behind until the daily buckets expire.
  const mock = createMockValkey(
    () => buckets,
    live.map((id, index) => meta(id, index, recent)),
  );
  const service = createService(mock);

  const countries = await service.getTrendingCountries();

  assert.equal(countries.length, 1);
  assert.deepEqual(
    countries[0].shares.map((share) => share.id),
    live.slice(0, 10),
  );
});

test("caps the country list at ten", async () => {
  const codes = [
    "PH",
    "US",
    "CA",
    "DE",
    "FR",
    "IT",
    "ES",
    "NL",
    "SE",
    "NO",
    "FI",
    "DK",
  ];
  const buckets = Array.from({ length: 24 }, () => null);
  buckets[0] = Object.fromEntries(
    codes.flatMap((code, index) => [
      [`c:${code}`, String(100 - index)],
      [`${code}:s${index}`, "1"],
    ]),
  );
  const mock = createMockValkey(
    () => buckets,
    codes.map((_, index) => meta(`s${index}`, 1, recent)),
  );
  const service = createService(mock);

  const countries = await service.getTrendingCountries();

  assert.equal(countries.length, 10);
  assert.deepEqual(
    countries.map((country) => country.country),
    codes.slice(0, 10),
  );
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

function recentShare({
  id,
  files,
  views = 1,
  security = null,
  reverseShare = null,
}) {
  return {
    id,
    name: `Share ${id}`,
    description: `Description for ${id}`,
    createdAt: new Date(recent),
    views,
    security,
    reverseShare,
    files: files.map((name, index) => ({
      id: `${id}-file-${index}`,
      name,
      size: "100",
    })),
  };
}

function recentPrisma(shares) {
  const calls = [];
  return {
    calls,
    prisma: {
      share: {
        findMany: async (args) => {
          calls.push(args);
          return shares;
        },
      },
    },
  };
}

test("lists only recent public media shares with a video flag", async () => {
  const { prisma, calls } = recentPrisma([
    recentShare({ id: "image", files: ["photo.jpg"] }),
    recentShare({ id: "video", files: ["clip.mp4", "photo.png"] }),
    recentShare({ id: "text", files: ["notes.txt"] }),
    recentShare({
      id: "protected",
      files: ["secret.jpg"],
      security: {
        password: "hash",
        maxViews: null,
        restrictToRecipients: false,
      },
    }),
    recentShare({ id: "zero", files: ["zero.jpg"], views: 0 }),
    recentShare({
      id: "private-reverse",
      files: ["private.jpg"],
      reverseShare: { publicAccess: false },
    }),
  ]);
  const service = createService(
    createMockValkey(() => []),
    prisma,
  );

  const items = await service.getRecent(100);

  assert.deepEqual(
    items.map((item) => item.id),
    ["image", "video", "zero"],
  );
  assert.equal(items[0].previewKind, "image");
  assert.equal(items[0].hasVideo, false);
  assert.equal(items[1].hasVideo, true);
  assert.equal(items[2].views, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].orderBy.createdAt, "desc");
  assert.equal(calls[0].take, 1000);
  assert.equal(calls[0].where.views, undefined);

  // The second read comes from the in-process cache.
  await service.getRecent(100);
  assert.equal(calls.length, 1);
});

test("caps the recent listing at two hundred shares", async () => {
  const shares = Array.from({ length: 240 }, (_, index) =>
    recentShare({ id: `share-${index}`, files: ["photo.jpg"] }),
  );
  const { prisma } = recentPrisma(shares);
  const service = createService(
    createMockValkey(() => []),
    prisma,
  );

  const items = await service.getRecent(1000);

  assert.equal(items.length, 200);
  assert.equal(items[0].id, "share-0");
  assert.equal(items[199].id, "share-199");
});

test("invalidating a share clears the recent listing cache", async () => {
  const { prisma, calls } = recentPrisma([
    recentShare({ id: "image", files: ["photo.jpg"] }),
  ]);
  const mock = createMockValkey(() => [1, [], 1]);
  const service = createService(mock, prisma);

  await service.getRecent(100);
  assert.equal(calls.length, 1);

  await service.invalidate("image");
  await service.getRecent(100);
  assert.equal(calls.length, 2);
});

test("serves the media and file listings from one scan", async () => {
  const { prisma, calls } = recentPrisma([
    recentShare({ id: "video", files: ["clip.mp4"] }),
    recentShare({ id: "document", files: ["notes.txt"] }),
    recentShare({ id: "image", files: ["photo.jpg"] }),
  ]);
  const service = createService(
    createMockValkey(() => []),
    prisma,
  );

  const media = await service.getRecent(100);
  const documents = await service.getRecentFiles(100);

  assert.deepEqual(
    media.map((item) => item.id),
    ["video", "image"],
  );
  assert.deepEqual(
    documents.map((item) => item.id),
    ["document"],
  );
  // Both listings share the same 30-second scan instead of querying twice.
  assert.equal(calls.length, 1);
});
