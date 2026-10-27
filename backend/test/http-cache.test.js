const test = require("node:test");
const assert = require("node:assert/strict");
const { isNotModified } = require("../dist/src/utils/cache.util.js");

const request = (ifNoneMatch) => ({
  headers: { "if-none-match": ifNoneMatch },
});

test("matches a single strong validator", () => {
  assert.equal(isNotModified(request('"share-file-12"'), '"share-file-12"'), true);
});

test("matches one validator in a list and ignores weak markers", () => {
  assert.equal(
    isNotModified(
      request('"other", "share-file-12" , W/"weaker"'),
      '"share-file-12"',
    ),
    true,
  );
  assert.equal(isNotModified(request("*"), '"share-file-12"'), true);
});

test("does not report a match for a different or missing validator", () => {
  assert.equal(isNotModified(request('"other"'), '"share-file-12"'), false);
  assert.equal(isNotModified(request(undefined), '"share-file-12"'), false);
  assert.equal(isNotModified(request('"share-file-12"'), undefined), false);
});
