const test = require("node:test");
const assert = require("node:assert/strict");
const { SearchService } = require("../dist/src/cache/search.service.js");

function createMockValkey(initial = []) {
  const store = new Map(initial);
  const calls = [];
  const client = {
    get: async (key) => {
      calls.push(["get", key]);
      return store.get(key);
    },
    set: async (key, value, options) => {
      calls.push(["set", key, value, options]);
      store.set(key, value);
    },
    del: async (key) => {
      calls.push(["del", key]);
      store.delete(key);
    },
    unlink: async (key) => {
      calls.push(["unlink", key]);
      store.delete(key);
    },
  };
  return {
    store,
    calls,
    valkey: { run: async (operation) => operation(client) },
  };
}

const share = (overrides = {}) => ({
  id: "abc123",
  name: "Holiday Photos",
  description: "Sunny beach",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
  views: 5,
  files: [{ id: "f1", name: "beach.jpg", size: "100" }],
  ...overrides,
});

test("stores the index without the duplicated lowercase search text or file names", async () => {
  const mock = createMockValkey();
  const prisma = { share: { findMany: async () => [share()] } };
  const service = new SearchService(prisma, mock.valkey);

  const results = await service.search("holiday");
  assert.deepEqual(
    results.map((item) => item.id),
    ["abc123"],
  );
  assert.equal(results[0].fileNames, undefined);

  const setCall = mock.calls.find((call) => call[0] === "set");
  const payload = JSON.parse(setCall[2]);
  assert.equal(payload.v, 5);
  assert.equal(payload.items[0].w, undefined);
  assert.equal(payload.items[0].fn, undefined);
});

test("matches the name, description and id from one in-process index", async () => {
  const mock = createMockValkey();
  let queries = 0;
  const prisma = {
    share: {
      findMany: async () => {
        queries += 1;
        return [share()];
      },
    },
  };
  const service = new SearchService(prisma, mock.valkey);

  assert.equal((await service.search("beach")).length, 1);
  assert.equal((await service.search("abc123")).length, 1);
  assert.equal(queries, 1);
});

test("ranks name matches before description matches", async () => {
  const mock = createMockValkey();
  const prisma = {
    share: {
      findMany: async () => [
        share({
          id: "description",
          name: "Beach trip",
          description: "Holiday photos from the coast",
        }),
        share({
          id: "contains",
          name: "Summer holiday album",
          description: "Warm days",
        }),
        share({ id: "exact", name: "holiday", description: "A short trip" }),
      ],
    },
  };
  const service = new SearchService(prisma, mock.valkey);

  const results = await service.search("holiday");
  assert.deepEqual(
    results.map((item) => item.id),
    ["exact", "contains", "description"],
  );
});

test("ignores an index written by an older version", async () => {
  const mock = createMockValkey([
    [
      "pingvin:search:index",
      JSON.stringify({ v: 3, items: [{ id: "old", w: "old" }] }),
    ],
  ]);
  let queries = 0;
  const prisma = {
    share: {
      findMany: async () => {
        queries += 1;
        return [share()];
      },
    },
  };
  const service = new SearchService(prisma, mock.valkey);

  const results = await service.search("holiday");
  assert.deepEqual(
    results.map((item) => item.id),
    ["abc123"],
  );
  assert.equal(queries, 1);
});
