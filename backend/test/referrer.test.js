const test = require("node:test");
const assert = require("node:assert/strict");
const { MetricsService } = require("../dist/src/cache/metrics.service.js");

const createService = () =>
  new MetricsService({ run: async () => undefined });

test("normalizes and counts external referrer domains", async () => {
  const service = createService();
  await service.recordReferrer("Example.com");
  await service.recordReferrer("www.example.com");
  await service.recordReferrer("example.com");
  await service.recordReferrer("news.example.org");
  await service.recordReferrer(undefined);
  await service.recordReferrer("localhost");
  await service.recordReferrer("192.168.1.1");
  await service.recordReferrer("bad domain");

  const page = await service.getReferrers(1, 50);
  assert.equal(page.total, 2);
  assert.deepEqual(page.referrers, [
    { domain: "example.com", views: 3 },
    { domain: "news.example.org", views: 1 },
  ]);
});

test("paginates the referrer ranking and caps the page size", async () => {
  const service = createService();
  for (let i = 0; i < 55; i += 1) {
    const domain = `site${String(i).padStart(2, "0")}.example`;
    for (let n = 0; n < 55 - i; n += 1) await service.recordReferrer(domain);
  }

  const first = await service.getReferrers(1, 50);
  assert.equal(first.total, 55);
  assert.equal(first.referrers.length, 50);
  assert.equal(first.referrers[0].domain, "site00.example");
  assert.equal(first.referrers[0].views, 55);

  const second = await service.getReferrers(2, 50);
  assert.equal(second.referrers.length, 5);
  assert.equal(second.referrers[4].domain, "site54.example");

  const oversized = await service.getReferrers(1, 10_000);
  assert.equal(oversized.pageSize, 100);
  assert.equal(oversized.referrers.length, 55);
});

test("returns an empty page when no referrers were recorded", async () => {
  const service = createService();
  const page = await service.getReferrers(1, 50);
  assert.deepEqual(page, {
    referrers: [],
    total: 0,
    page: 1,
    pageSize: 50,
  });
});
