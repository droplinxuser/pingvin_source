const test = require("node:test");
const assert = require("node:assert/strict");
const { MetricsService } = require("../dist/src/cache/metrics.service.js");

const unavailableValkey = { run: async () => undefined };

test("aggregates page views and top countries in the memory fallback", async () => {
  const metrics = new MetricsService(unavailableValkey);

  await metrics.recordPageView("PH");
  await metrics.recordPageView("US");
  await metrics.recordPageView("PH");
  await metrics.recordPageView("CA");
  await metrics.recordPageView("PH");

  const result = await metrics.getLastDay();
  assert.equal(result.pageViewsLastDay, 5);
  assert.deepEqual(result.topCountriesLastDay, [
    { country: "PH", count: 3 },
    { country: "CA", count: 1 },
    { country: "US", count: 1 },
  ]);
});

test("keeps only the last 24 hourly buckets", async () => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    const metrics = new MetricsService(unavailableValkey);
    await metrics.recordPageView("PH");

    now += 23 * 60 * 60 * 1000;
    const withinWindow = await metrics.recordPageView("US");
    assert.equal(withinWindow.pageViewsLastDay, 2);
    assert.deepEqual(withinWindow.topCountriesLastDay, [
      { country: "PH", count: 1 },
      { country: "US", count: 1 },
    ]);

    now += 2 * 60 * 60 * 1000;
    const expired = await metrics.recordPageView("CA");
    assert.equal(expired.pageViewsLastDay, 2);
    assert.deepEqual(expired.topCountriesLastDay, [
      { country: "CA", count: 1 },
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
  const result = await metrics.getLastDay();
  assert.equal(result.pageViewsLastDay, 2);
  assert.deepEqual(result.topCountriesLastDay, []);
});
