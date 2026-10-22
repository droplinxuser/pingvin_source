const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ShareWriteBufferService,
} = require("../dist/src/cache/shareWriteBuffer.service.js");

const unavailableValkey = { run: async () => undefined };

test("falls back to a direct database view increment", async () => {
  let updatedWhere;
  const prisma = {
    share: {
      update: async ({ where }) => {
        updatedWhere = where;
        return { views: 7 };
      },
      updateMany: async () => ({ count: 1 }),
    },
  };
  const buffer = new ShareWriteBufferService(unavailableValkey, prisma);

  const result = await buffer.recordView("share-1", 6, 10);
  assert.deepEqual(result, { status: "ok", views: 7 });
  assert.deepEqual(updatedWhere, {
    id: "share-1",
    views: { lt: 10 },
  });
  assert.equal(await buffer.getViews("share-1", 6), 6);
});

test("falls back to a direct database expiration update", async () => {
  let updatedExpiration;
  const prisma = {
    share: {
      updateMany: async ({ data }) => {
        updatedExpiration = data.expiration;
        return { count: 1 };
      },
    },
  };
  const buffer = new ShareWriteBufferService(unavailableValkey, prisma);
  const expiration = new Date("2030-01-01T00:00:00.000Z");

  await buffer.queueExpiration("share-1", expiration);
  assert.equal(updatedExpiration.toISOString(), expiration.toISOString());
});

test("flushing is a no-op when Valkey is unavailable", async () => {
  const buffer = new ShareWriteBufferService(unavailableValkey, {
    share: {},
  });
  await buffer.flush();
});
