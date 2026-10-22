const test = require("node:test");
const assert = require("node:assert/strict");
const { JwtService } = require("@nestjs/jwt");
const {
  createVisitorIdentityMiddleware,
} = require("../dist/src/utils/visitorIdentity.util.js");

const jwt = new JwtService({});
const secret = "test-secret";
const middleware = createVisitorIdentityMiddleware(jwt, secret, false);

function run(cookies = {}) {
  return new Promise((resolve) => {
    const req = { cookies, headers: {}, ip: "203.0.113.7" };
    const res = {
      cookies: [],
      cookie(name, value) {
        this.cookies.push([name, value]);
      },
    };
    middleware(req, res, () => resolve({ req, res }));
  });
}

test("issues a signed visitor cookie and keys the first request by IP", async () => {
  const { req, res } = await run();
  assert.equal(req.visitorKey, "ip:203.0.113.7");
  assert.equal(res.cookies.length, 1);
  assert.equal(res.cookies[0][0], "pingvin_visitor");

  const visitor = await run({ pingvin_visitor: res.cookies[0][1] });
  assert.match(visitor.req.visitorKey, /^visitor:[0-9a-f-]{36}$/);
  assert.equal(visitor.res.cookies.length, 0);
});

test("ignores forged cookies and keys signed-in users by account ID", async () => {
  const forged = await run({ pingvin_visitor: "not-a-jwt" });
  assert.equal(forged.req.visitorKey, "ip:203.0.113.7");

  const accessToken = await jwt.signAsync({ sub: "user-1" }, { secret });
  const user = await run({ access_token: accessToken });
  assert.equal(user.req.visitorKey, "user:user-1");
});
