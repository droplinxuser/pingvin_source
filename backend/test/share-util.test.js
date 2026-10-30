const test = require("node:test");
const assert = require("node:assert/strict");
const { isShareExpired } = require("../dist/src/share/share.util.js");

test("treats the epoch as never expiring", () => {
  assert.equal(isShareExpired(new Date(0)), false);
  assert.equal(isShareExpired(new Date(0), Date.now()), false);
});

test("accepts a future date", () => {
  assert.equal(isShareExpired(new Date(Date.now() + 60_000)), false);
});

test("rejects a past date and the exact boundary", () => {
  const now = Date.now();
  assert.equal(isShareExpired(new Date(now - 1), now), true);
  assert.equal(isShareExpired(new Date(now), now), true);
});

test("parses an ISO string the same way as a Date", () => {
  const now = Date.now();
  assert.equal(isShareExpired(new Date(now - 60_000).toISOString(), now), true);
  assert.equal(
    isShareExpired(new Date(now + 60_000).toISOString(), now),
    false,
  );
});

test("does not mark an invalid date as expired", () => {
  assert.equal(isShareExpired("not-a-date"), false);
});
