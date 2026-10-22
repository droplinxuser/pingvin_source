const test = require("node:test");
const assert = require("node:assert/strict");
const {
  signVisitorId,
  verifyVisitorId,
} = require("../dist/src/utils/visitorIdentity.util.js");

const id = "123e4567-e89b-42d3-a456-426614174000";
const secret = "test-secret";

test("accepts a correctly signed visitor id", () => {
  assert.equal(verifyVisitorId(signVisitorId(id, secret), secret), id);
});

test("rejects tampered or malformed visitor cookies", () => {
  assert.equal(verifyVisitorId(`${id}.invalid`, secret), undefined);
  assert.equal(verifyVisitorId("not-a-uuid.signature", secret), undefined);
  assert.equal(verifyVisitorId(undefined, secret), undefined);
});

test("rejects a cookie signed with another secret", () => {
  assert.equal(
    verifyVisitorId(signVisitorId(id, "other-secret"), secret),
    undefined,
  );
});
