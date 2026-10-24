const test = require("node:test");
const assert = require("node:assert/strict");
const uploaderInfo = require("../dist/src/utils/uploaderInfo.util.js");
const {
  ShareStateService,
} = require("../dist/src/share/shareState.service.js");

const request = { headers: { "user-agent": "Mozilla/5.0 Test" }, hostname: "site.com" };

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
