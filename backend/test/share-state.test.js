const test = require("node:test");
const assert = require("node:assert/strict");
const uploaderInfo = require("../dist/src/utils/uploaderInfo.util.js");
const {
  ShareStateService,
} = require("../dist/src/share/shareState.service.js");

const request = {
  headers: { "user-agent": "Mozilla/5.0 Test" },
  hostname: "site.com",
};

function createService() {
  return new ShareStateService(
    {},
    { t: (key) => key },
    { invalidate: async () => {} },
    {},
  );
}

function captureVisitorWrites() {
  const writes = [];
  uploaderInfo.readUploaderInfo = async () => null;
  uploaderInfo.writeUploaderInfo = async (shareId, info) => {
    writes.push({ shareId, visitors: info.visitors });
  };
  uploaderInfo.getVisitorInfo = () => ({
    createdAt: new Date().toISOString(),
  });
  return writes;
}

test("coalesces rapid views into one uploader.json write", async () => {
  const writes = captureVisitorWrites();
  const service = createService();

  await Promise.all(
    Array.from({ length: 5 }, () => service.recordVisitor("share", request)),
  );
  assert.equal(writes.length, 0);

  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].visitors.length, 5);
});

test("flushes a pending visitor during shutdown", async () => {
  const writes = captureVisitorWrites();
  const service = createService();

  await service.recordVisitor("share", request);
  await service.onApplicationShutdown();

  assert.equal(writes.length, 1);
  assert.equal(writes[0].visitors.length, 1);
});

test("reuses a flushed visitor snapshot instead of reading the file again", async () => {
  const writes = captureVisitorWrites();
  let reads = 0;
  uploaderInfo.readUploaderInfo = async () => {
    reads += 1;
    return null;
  };
  const service = createService();

  await service.recordVisitor("share", request);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(writes.length, 1);

  await service.recordVisitor("share", request);
  assert.equal(reads, 1);

  // Shutdown only writes entries with unflushed views, but keeps the full
  // visitor history from the snapshot.
  await service.onApplicationShutdown();
  assert.equal(writes.length, 2);
  assert.equal(writes[1].visitors.length, 2);
});

test("persists a rolling expiration at most once per interval", async () => {
  const cacheUtil = require("../dist/src/utils/cache.util.js");
  const originalGet = cacheUtil.getCachedValue;
  const originalSet = cacheUtil.setCachedValue;
  cacheUtil.getCachedValue = async () => undefined;
  cacheUtil.setCachedValue = async () => {};

  const originalExpiration = new Date(Date.now() + 60 * 1000);
  const share = {
    id: "share",
    name: "Share",
    uploadLocked: true,
    removedReason: null,
    expiration: originalExpiration,
    files: [],
    creator: null,
    security: null,
    createdAt: new Date(),
    updatedAt: null,
    views: 0,
    storageProvider: "LOCAL",
    creatorId: null,
    reverseShareId: null,
    isZipReady: false,
    description: null,
  };
  let updates = 0;
  const prisma = {
    share: {
      findUnique: async () => ({ ...share, expiration: originalExpiration }),
      updateMany: async () => {
        updates += 1;
        return { count: 1 };
      },
    },
  };
  const service = new ShareStateService(
    prisma,
    { t: (key) => key },
    { invalidate: async () => {} },
    {},
  );

  try {
    const first = await service.getShare("share");
    const second = await service.getShare("share");

    assert.equal(updates, 1);
    assert.ok(first.expiration > originalExpiration);
    assert.ok(second.expiration > originalExpiration);
  } finally {
    cacheUtil.getCachedValue = originalGet;
    cacheUtil.setCachedValue = originalSet;
  }
});

test("keeps a non-expiring share's expiration untouched", async () => {
  const cacheUtil = require("../dist/src/utils/cache.util.js");
  const originalGet = cacheUtil.getCachedValue;
  const originalSet = cacheUtil.setCachedValue;
  cacheUtil.getCachedValue = async () => undefined;
  cacheUtil.setCachedValue = async () => {};

  let updates = 0;
  const prisma = {
    share: {
      findUnique: async () => ({
        id: "never",
        name: "Never",
        uploadLocked: true,
        removedReason: null,
        expiration: new Date(0),
        files: [],
        creator: null,
        security: null,
      }),
      updateMany: async () => {
        updates += 1;
        return { count: 1 };
      },
    },
  };
  const service = new ShareStateService(
    prisma,
    { t: (key) => key },
    { invalidate: async () => {} },
    {},
  );

  try {
    await service.getShare("never");
    assert.equal(updates, 0);
  } finally {
    cacheUtil.getCachedValue = originalGet;
    cacheUtil.setCachedValue = originalSet;
  }
});

test("coalesces concurrent cold share loads", async () => {
  const cacheUtil = require("../dist/src/utils/cache.util.js");
  const originalGet = cacheUtil.getCachedValue;
  const originalSet = cacheUtil.setCachedValue;
  cacheUtil.getCachedValue = async () => undefined;
  cacheUtil.setCachedValue = async () => {};

  let lookups = 0;
  const prisma = {
    share: {
      findUnique: async () => {
        lookups += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          id: "cold",
          name: "Cold",
          uploadLocked: true,
          removedReason: null,
          expiration: new Date(0),
          files: [{ id: "file", name: "a.txt", size: "5" }],
          creator: null,
          security: null,
        };
      },
    },
  };
  const service = new ShareStateService(
    prisma,
    { t: (key) => key },
    { invalidate: async () => {} },
    {},
  );

  try {
    const [first, second] = await Promise.all([
      service.getShare("cold"),
      service.getShare("cold"),
    ]);
    assert.equal(lookups, 1);
    assert.equal(first.size, 5);
    assert.equal(second.size, 5);
  } finally {
    cacheUtil.getCachedValue = originalGet;
    cacheUtil.setCachedValue = originalSet;
  }
});

test("increments a limited view with one conditional update", async () => {
  let lookups = 0;
  const prisma = {
    $queryRaw: async () => [{ views: 4 }],
    share: {
      findUnique: async () => {
        lookups += 1;
        return null;
      },
    },
  };
  const service = new ShareStateService(
    prisma,
    { t: (key) => key },
    { invalidate: async () => {} },
    {},
  );

  const views = await service.recordLimitedView("share", 5);
  assert.equal(views, 4);
  assert.equal(lookups, 0);
});

test("batches unlimited views and still returns each live count", async () => {
  let persisted = 10;
  const increments = [];
  const prisma = {
    share: {
      findUnique: async () => ({ views: persisted }),
      update: async ({ data }) => {
        increments.push(data.views.increment);
        persisted += data.views.increment;
        return { views: persisted };
      },
    },
  };
  const service = new ShareStateService(
    prisma,
    { t: (key) => key },
    { invalidate: async () => {} },
    {},
  );

  assert.equal(await service.recordUnlimitedView("share"), 11);
  assert.equal(await service.recordUnlimitedView("share"), 12);
  assert.equal(increments.length, 0);

  await service.flushViews();
  assert.deepEqual(increments, [2]);
  assert.equal(persisted, 12);

  assert.equal(await service.recordUnlimitedView("share"), 13);
  await service.onApplicationShutdown();
  assert.deepEqual(increments, [2, 1]);
  assert.equal(persisted, 13);
});

test("flushes batched views on shutdown", async () => {
  let persisted = 4;
  const increments = [];
  const prisma = {
    share: {
      findUnique: async () => ({ views: persisted }),
      update: async ({ data }) => {
        increments.push(data.views.increment);
        persisted += data.views.increment;
        return { views: persisted };
      },
    },
  };
  const service = new ShareStateService(
    prisma,
    { t: (key) => key },
    { invalidate: async () => {} },
    {},
  );

  await service.recordUnlimitedView("share");
  await service.recordUnlimitedView("share");
  await service.onApplicationShutdown();
  assert.deepEqual(increments, [2]);
  assert.equal(persisted, 6);
});

test("reports the view limit or a missing share after a failed update", async () => {
  const serviceWith = (share) =>
    new ShareStateService(
      {
        $queryRaw: async () => [],
        share: { findUnique: async () => share },
      },
      { t: (key) => key },
      { invalidate: async () => {} },
      {},
    );

  await assert.rejects(
    serviceWith({ views: 5 }).recordLimitedView("share", 5),
    (error) => error.getStatus() === 403,
  );
  await assert.rejects(
    serviceWith(null).recordLimitedView("share", 5),
    (error) => error.getStatus() === 404,
  );
});

test("reuses the share row's counter for the first unlimited view", async () => {
  const cacheUtil = require("../dist/src/utils/cache.util.js");
  const originalGet = cacheUtil.getCachedValue;
  const originalSet = cacheUtil.setCachedValue;
  cacheUtil.getCachedValue = async () => undefined;
  cacheUtil.setCachedValue = async () => {};

  captureVisitorWrites();
  let lookups = 0;
  let increments = 0;
  const prisma = {
    share: {
      findUnique: async () => {
        lookups += 1;
        return {
          id: "views",
          name: "Views",
          uploadLocked: true,
          removedReason: null,
          expiration: new Date(0),
          files: [],
          creator: null,
          security: null,
          views: 41,
        };
      },
      update: async ({ data }) => {
        increments += 1;
        return { views: 41 + data.views.increment };
      },
    },
  };
  const service = new ShareStateService(
    prisma,
    { t: (key) => key },
    { invalidate: async () => {} },
    {},
  );

  try {
    await service.getShare("views");
    const { views } = await service.recordView("views", request);
    assert.equal(views, 42);
    // The GET already read the row; counting must not run another SELECT.
    assert.equal(lookups, 1);

    await new Promise((resolve) => setTimeout(resolve, 5200));
    assert.equal(increments, 1);
  } finally {
    await service.onApplicationShutdown();
    cacheUtil.getCachedValue = originalGet;
    cacheUtil.setCachedValue = originalSet;
  }
});

test("serves the view-limited counter from the last atomic write", async () => {
  captureVisitorWrites();
  let selects = 0;
  let rawCalls = 0;
  const prisma = {
    $queryRaw: async () => {
      rawCalls += 1;
      return [{ views: 3 }];
    },
    share: {
      findUnique: async () => {
        selects += 1;
        return { views: 3 };
      },
    },
  };
  const service = new ShareStateService(
    prisma,
    { t: (key) => key },
    { invalidate: async () => {} },
    {},
  );

  try {
    const { views } = await service.recordView("limited", request, 5);
    assert.equal(views, 3);
    assert.equal(await service.getCurrentViews("limited"), 3);
    assert.equal(await service.getCurrentViews("limited"), 3);
    assert.equal(rawCalls, 1);
    // A gallery's file requests reuse the recorded value instead of SELECTs.
    assert.equal(selects, 0);
  } finally {
    await service.onApplicationShutdown();
  }
});
