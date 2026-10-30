const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { NotFoundException } = require("@nestjs/common");
const { ShareService } = require("../dist/src/share/share.service.js");

function createService({ rows = [] } = {}) {
  const calls = {
    updates: [],
    invalidations: 0,
    thumbnails: 0,
    searches: 0,
    deletes: 0,
  };
  const prisma = {
    $queryRaw: async () => rows.shift() ?? [],
    share: {
      updateMany: async (args) => {
        calls.updates.push(args);
        return { count: 1 };
      },
    },
  };
  const shareState = {
    getGuardShare: async () => ({ security: { maxDownloads: 1 } }),
    invalidateData: async () => {
      calls.invalidations += 1;
    },
    invalidateDataCache: async () => {},
  };
  const fileService = {
    removeShareThumbnail: async () => {
      calls.thumbnails += 1;
    },
    deleteAllFiles: async () => {
      calls.deletes += 1;
    },
  };
  const searchService = {
    invalidate: async () => {
      calls.searches += 1;
    },
  };
  const i18n = { t: (key) => key };
  const service = new ShareService(
    prisma,
    null,
    fileService,
    null,
    null,
    null,
    null,
    null,
    null,
    i18n,
    shareState,
    null,
    searchService,
    null,
  );
  return { service, calls };
}

test("burning a share expires it without deleting files or interrupting a stream", async () => {
  const { service, calls } = createService();
  const stream = Readable.from([
    Buffer.from("part-one"),
    Buffer.from("-part-two"),
  ]);
  const chunks = [];
  const completed = new Promise((resolve, reject) => {
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });

  await service.burnShare("share", 5 * 60 * 1000);
  await completed;

  assert.equal(Buffer.concat(chunks).toString(), "part-one-part-two");
  assert.equal(calls.deletes, 0);
  assert.equal(calls.thumbnails, 1);
  assert.equal(calls.searches, 1);
  assert.equal(calls.invalidations, 1);
  assert.ok(calls.updates[0].data.expiration.getTime() > Date.now());
});

test("the final download slot burns the share after the grace period", async () => {
  const { service, calls } = createService({
    rows: [[{ downloadCount: 1 }]],
  });

  await service.reserveDownload("share", 1);

  assert.equal(calls.deletes, 0);
  assert.equal(calls.invalidations, 1);
  assert.ok(
    calls.updates[0].data.expiration.getTime() > Date.now() + 4 * 60 * 1000,
  );
});

test("an exhausted download cap burns and returns 404", async () => {
  const { service, calls } = createService({ rows: [[]] });

  await assert.rejects(
    () => service.reserveDownload("share", 1),
    (error) => error instanceof NotFoundException,
  );

  assert.equal(calls.deletes, 0);
  assert.ok(
    calls.updates[0].data.expiration.getTime() > Date.now() + 4 * 60 * 1000,
  );
});

test("two concurrent requests cannot both consume the final download slot", async () => {
  let count = 0;
  const { service } = createService();
  // Simulate the SQL conditional update: only the first caller gets a row.
  service.prisma = {
    share: { updateMany: async () => ({ count: 1 }) },
    $queryRaw: async () => {
      const current = count;
      if (current >= 1) return [];
      count = current + 1;
      return [{ downloadCount: count }];
    },
  };

  const results = await Promise.allSettled([
    service.reserveDownload("share", 1),
    service.reserveDownload("share", 1),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  assert.equal(count, 1);
});

test("a page read at a reached limit burns the share and returns 404", async () => {
  const { service, calls } = createService();
  service.shareState.getShare = async () => ({
    id: "share",
    views: 2,
    maxViews: 2,
    maxDownloads: null,
    downloadCount: 0,
  });

  await assert.rejects(
    () => service.get("share"),
    (error) => error instanceof NotFoundException,
  );
  assert.equal(calls.deletes, 0);
  assert.equal(calls.thumbnails, 1);
  assert.equal(calls.searches, 1);
  assert.equal(calls.invalidations, 1);
});
