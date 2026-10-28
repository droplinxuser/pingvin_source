const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isViewLimitExceeded,
  sumFileSizes,
} = require("../dist/src/share/share.util.js");

test("allows file access on the last permitted view", () => {
  assert.equal(isViewLimitExceeded(1, 1, true), false);
  assert.equal(isViewLimitExceeded(2, 1, true), true);
});

test("blocks new share tokens when the limit is reached", () => {
  assert.equal(isViewLimitExceeded(0, 1), false);
  assert.equal(isViewLimitExceeded(1, 1), true);
});

test("zero means unlimited", () => {
  assert.equal(isViewLimitExceeded(100, 0), false);
  assert.equal(isViewLimitExceeded(100, undefined), false);
});
