const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createThrottlerOptions,
} = require("../dist/src/cache/throttler.config.js");

const options = createThrottlerOptions({ run: async () => undefined });
const generateKey = options.throttlers[0].generateKey;

const context = (handler, controller) => ({
  getHandler: () => handler,
  getClass: () => controller,
});

test("keeps route overrides out of the shared visitor bucket", () => {
  const ordinary = function getShare() {};
  const limited = function createComment() {};
  Reflect.defineMetadata("THROTTLER:LIMITdefault", 5, limited);

  class ShareController {}

  const shared = generateKey(
    context(ordinary, ShareController),
    "ip:127.0.0.1",
    "default",
  );
  const route = generateKey(
    context(limited, ShareController),
    "ip:127.0.0.1",
    "default",
  );

  assert.notEqual(shared, route);
  // The same route and visitor always map to the same bucket.
  assert.equal(
    shared,
    generateKey(
      context(ordinary, ShareController),
      "ip:127.0.0.1",
      "default",
    ),
  );
  assert.equal(
    route,
    generateKey(
      context(limited, ShareController),
      "ip:127.0.0.1",
      "default",
    ),
  );
});
