const test = require("node:test");
const assert = require("node:assert/strict");
const { MetricsService } = require("../dist/src/cache/metrics.service.js");

const unavailableValkey = { run: async () => undefined };

test("aggregates page views and top countries in the memory fallback", async () => {
  const metrics = new MetricsService(unavailableValkey);

  await metrics.recordPageView("PH", "visitor-1");
  await metrics.recordPageView("US", "visitor-2");
  await metrics.recordPageView("PH", "visitor-1");
  await metrics.recordPageView("CA", "visitor-3");
  await metrics.recordPageView("PH", "visitor-4");

  const result = await metrics.getLastHour();
  assert.equal(result.pageViewsLastHour, 5);
  assert.deepEqual(result.topCountriesLastHour, [
    { country: "PH", count: 2 },
    { country: "CA", count: 1 },
    { country: "US", count: 1 },
  ]);
});

test("keeps only the last 60 minute buckets", async () => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    const metrics = new MetricsService(unavailableValkey);
    await metrics.recordPageView("PH", "visitor-1");
    now += 61 * 60 * 1000;
    const result = await metrics.recordPageView("US", "visitor-2");

    assert.equal(result.pageViewsLastHour, 1);
    assert.deepEqual(result.topCountriesLastHour, [
      { country: "US", count: 1 },
    ]);
  } finally {
    Date.now = realNow;
  }
});

test("ignores unknown and invalid country codes", async () => {
  const metrics = new MetricsService(unavailableValkey);
  await metrics.recordPageView("XX");
  await metrics.recordPageView("invalid");
  const result = await metrics.getLastHour();
  assert.equal(result.pageViewsLastHour, 2);
  assert.deepEqual(result.topCountriesLastHour, []);
});
