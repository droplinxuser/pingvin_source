const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createVisitorIdentityMiddleware,
} = require("../dist/src/utils/visitorIdentity.util.js");

const middleware = createVisitorIdentityMiddleware();

function run({
  ip = "203.0.113.7",
  userAgent = "Mozilla/5.0 Test",
  omitUserAgent = false,
  headers = {},
} = {}) {
  return new Promise((resolve) => {
    const request = {
      ip,
      headers: {
        ...(omitUserAgent ? {} : { "user-agent": userAgent }),
        ...headers,
      },
      socket: { remoteAddress: ip },
    };
    const response = {
      cookie() {
        throw new Error("rate-limit identity must not set cookies");
      },
    };
    middleware(request, response, () => resolve(request));
  });
}

test("keys by IP and user agent without setting a cookie", async () => {
  const first = await run();
  const same = await run();

  assert.equal(first.visitorKey, "ipua:203.0.113.7\nMozilla/5.0 Test");
  assert.equal(same.visitorKey, first.visitorKey);
});

test("separates different IPs and user agents", async () => {
  const base = await run();
  const otherUserAgent = await run({ userAgent: "Other/1.0" });
  const otherIp = await run({ ip: "198.51.100.9" });

  assert.notEqual(otherUserAgent.visitorKey, base.visitorKey);
  assert.notEqual(otherIp.visitorKey, base.visitorKey);
});

test("uses a stable placeholder when the user agent is missing", async () => {
  const first = await run({ omitUserAgent: true });
  const second = await run({ omitUserAgent: true });

  assert.equal(first.visitorKey, "ipua:203.0.113.7\nunknown");
  assert.equal(second.visitorKey, first.visitorKey);
});

test("ignores legacy visitor cookies", async () => {
  const request = await run({
    headers: { cookie: "pingvin_visitor=forged" },
  });

  assert.equal(request.visitorKey, "ipua:203.0.113.7\nMozilla/5.0 Test");
});
