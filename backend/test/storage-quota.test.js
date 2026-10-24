const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getUserActiveStorageUsage,
} = require("../dist/src/utils/storageQuota.util.js");

function createPrisma(result) {
  return {
    $queryRaw: async () => result,
  };
}

test("returns the SQLite storage total as a number", async () => {
  const usage = await getUserActiveStorageUsage(
    createPrisma([{ size: 12_345n }]),
    "user-1",
  );
  assert.equal(usage, 12345);
});

test("treats an empty aggregate as zero", async () => {
  const usage = await getUserActiveStorageUsage(
    createPrisma([{ size: null }]),
    "user-1",
  );
  assert.equal(usage, 0);
});
