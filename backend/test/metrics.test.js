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

test("ranks all-time countries, operating systems and browsers", async () => {
  const metrics = new MetricsService(unavailableValkey);

  await metrics.recordPageView("US", "Windows", "Chrome");
  await metrics.recordPageView("US", "Android", "Chrome");
  await metrics.recordPageView("PH", "iOS", "Safari");
  await metrics.recordPageView("PH", "Android", "Firefox");
  await metrics.recordPageView(undefined, "Chrome OS", "Microsoft Edge");

  const overall = await metrics.getOverallStats();
  assert.equal(overall.totalPageViews, 5);
  assert.deepEqual(overall.topCountries, [
    { country: "PH", count: 2 },
    { country: "US", count: 2 },
  ]);
  assert.deepEqual(
    Object.fromEntries(
      overall.topOperatingSystems.map((entry) => [entry.name, entry.count]),
    ),
    { Android: 2, ChromeOS: 1, iOS: 1, Windows: 1 },
  );
  assert.deepEqual(
    Object.fromEntries(
      overall.topBrowsers.map((entry) => [entry.name, entry.count]),
    ),
    { Chrome: 2, Edge: 1, Firefox: 1, Safari: 1 },
  );
});

test("caps the all-time country ranking at twenty", async () => {
  const metrics = new MetricsService(unavailableValkey);
  const codes = Array.from({ length: 25 }, (_, index) =>
    String.fromCharCode(65 + Math.floor(index / 26), 65 + (index % 26)),
  );

  for (const code of codes) await metrics.recordPageView(code, "Linux", "Chrome");

  const overall = await metrics.getOverallStats();
  assert.equal(overall.totalPageViews, 25);
  assert.equal(overall.topCountries.length, 20);
});
