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

test("keys by IP without setting a cookie", async () => {
  const first = await run();
  const same = await run();

  assert.equal(first.visitorKey, "ip:203.0.113.7");
  assert.equal(same.visitorKey, first.visitorKey);
});

test("ignores the attacker-controlled user agent", async () => {
  const base = await run();
  const otherUserAgent = await run({ userAgent: "Other/1.0" });
  const otherIp = await run({ ip: "198.51.100.9" });

  assert.equal(otherUserAgent.visitorKey, base.visitorKey);
  assert.notEqual(otherIp.visitorKey, base.visitorKey);
});

test("stays stable when the user agent is missing", async () => {
  const first = await run({ omitUserAgent: true });
  const second = await run({ omitUserAgent: true });

  assert.equal(first.visitorKey, "ip:203.0.113.7");
  assert.equal(second.visitorKey, first.visitorKey);
});

test("ignores legacy visitor cookies", async () => {
  const request = await run({
    headers: { cookie: "pingvin_visitor=forged" },
  });

  assert.equal(request.visitorKey, "ip:203.0.113.7");
});
