const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isShareExpired,
  isPublicShare,
  isAccessPublicShare,
  isShareLimitReached,
  parseSizeLimit,
  resolveShareSizeLimit,
} = require("../dist/src/share/share.util.js");

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

test("falls back when a stored size limit overflows or is invalid", () => {
  const fallback = 5_000_000;
  assert.equal(parseSizeLimit("9".repeat(400), fallback), fallback);
  assert.equal(parseSizeLimit("Infinity", fallback), fallback);
  assert.equal(parseSizeLimit("0", fallback), fallback);
  assert.equal(parseSizeLimit("", fallback), fallback);
  assert.equal(parseSizeLimit("1234", fallback), 1234);
});

test("resolveShareSizeLimit clamps an overflowed reverse-share limit", () => {
  assert.equal(
    resolveShareSizeLimit(5_000_000, {
      reverseShare: { maxShareSize: "9".repeat(400) },
    }),
    5_000_000,
  );
});

test("a download cap stays accessible but is not public/cacheable", () => {
  const share = { security: { maxDownloads: 1 } };
  assert.equal(isAccessPublicShare(share), true);
  assert.equal(isPublicShare(share), false);
});

test("passwords, view caps and private reverse shares block public access", () => {
  assert.equal(isAccessPublicShare({ security: { password: "hash" } }), false);
  assert.equal(isAccessPublicShare({ security: { maxViews: 2 } }), false);
  assert.equal(
    isAccessPublicShare({ reverseShare: { publicAccess: false } }),
    false,
  );
  assert.equal(isPublicShare({}), true);
  assert.equal(isAccessPublicShare({}), true);
});

test("detects exhausted view and download caps, including one-time links", () => {
  assert.equal(isShareLimitReached({ views: 1, maxViews: 2 }), false);
  assert.equal(isShareLimitReached({ views: 2, maxViews: 2 }), true);
  assert.equal(
    isShareLimitReached({ downloadCount: 1, maxDownloads: 2 }),
    false,
  );
  assert.equal(
    isShareLimitReached({ downloadCount: 2, maxDownloads: 2 }),
    true,
  );
  assert.equal(
    isShareLimitReached({ downloadCount: 1, maxDownloads: 1 }),
    true,
  );
  assert.equal(isShareLimitReached({ views: 99, maxViews: 0 }), false);
});
