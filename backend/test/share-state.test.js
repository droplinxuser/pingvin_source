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
