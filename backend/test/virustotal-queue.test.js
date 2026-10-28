const test = require("node:test");
const assert = require("node:assert/strict");
const {
  VirusTotalQueueService,
} = require("../dist/src/virustotal/virustotalQueue.service.js");

const QUEUE_KEY = "pingvin:virustotal:queue";

function createValkey() {
  const lists = new Map();
  const client = {
    rPush: async (key, value) => {
      const list = lists.get(key) ?? [];
      list.push(value);
      lists.set(key, list);
      return list.length;
    },
    lTrim: async () => {},
    lPop: async (key) => {
      const list = lists.get(key) ?? [];
      return list.shift() ?? null;
    },
    lRange: async (key, start, stop) => {
      const list = lists.get(key) ?? [];
      return list.slice(start, stop === -1 ? undefined : stop + 1);
    },
    lLen: async (key) => (lists.get(key) ?? []).length,
    lRem: async (key, _count, value) => {
      const list = lists.get(key) ?? [];
      let removed = 0;
      for (let index = list.length - 1; index >= 0; index--) {
        if (list[index] !== value) continue;
        list.splice(index, 1);
        removed++;
      }
      return removed;
    },
    multi() {
      const queue = [];
      const chain = {
        lRem: (...args) => {
          queue.push(args);
          return chain;
        },
        exec: async () => {
          for (const args of queue) await client.lRem(...args);
          return [];
        },
      };
      return chain;
    },
  };

  return {
    lists,
    valkey: { run: async (operation) => operation(client) },
  };
}

const job = (overrides = {}) => ({
  stage: "hash",
  shareId: "share-1",
  fileId: "file-1",
  name: "document.pdf",
  size: 1024,
  attempts: 0,
  ...overrides,
});

test("pushes and pops jobs through the Valkey queue", async () => {
  const mock = createValkey();
  const queue = new VirusTotalQueueService(mock.valkey);

  await queue.push(job());
  await queue.push(job({ fileId: "file-2", hash: "a".repeat(64) }));

  assert.equal((await queue.getDepth()).depth, 2);
  assert.equal((await queue.getDepth()).backend, "valkey");
  assert.equal((await queue.pop()).fileId, "file-1");
  assert.equal((await queue.pop()).fileId, "file-2");
  assert.equal(await queue.pop(), undefined);
});

test("removes every queued job for a deleted share", async () => {
  const mock = createValkey();
  const queue = new VirusTotalQueueService(mock.valkey);

  await queue.push(job({ shareId: "share-1", fileId: "file-1" }));
  await queue.push(job({ shareId: "share-1", fileId: "file-2" }));
  await queue.push(job({ shareId: "share-2", fileId: "file-3" }));

  await queue.removeForShare("share-1");

  assert.equal((await queue.getDepth()).depth, 1);
  assert.equal((await queue.pop()).shareId, "share-2");
});

test("removes only the queued job for a deleted file", async () => {
  const mock = createValkey();
  const queue = new VirusTotalQueueService(mock.valkey);

  await queue.push(job({ shareId: "share-1", fileId: "file-1" }));
  await queue.push(job({ shareId: "share-1", fileId: "file-2" }));

  await queue.removeForFile("share-1", "file-1");

  assert.equal((await queue.getDepth()).depth, 1);
  assert.equal((await queue.pop()).fileId, "file-2");
});

test("removes jobs from the memory fallback when Valkey is unavailable", async () => {
  const unavailable = { run: async () => undefined };
  const queue = new VirusTotalQueueService(unavailable);

  await queue.push(job({ shareId: "share-1", fileId: "file-1" }));
  await queue.push(job({ shareId: "share-1", fileId: "file-2" }));
  await queue.push(job({ shareId: "share-2", fileId: "file-3" }));

  await queue.removeForShare("share-1");

  const depth = await queue.getDepth();
  assert.equal(depth.depth, 1);
  assert.equal(depth.backend, "memory");
  assert.equal((await queue.pop()).fileId, "file-3");
});
