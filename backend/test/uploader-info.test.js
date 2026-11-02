const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getUploaderInfo,
  getVisitorInfo,
} = require("../dist/src/utils/uploaderInfo.util.js");

const request = (userAgent, headers = {}) => ({
  headers: { "user-agent": userAgent, ...headers },
  hostname: "site.com",
});

test("normalizes browser and OS names", () => {
  const info = getUploaderInfo(
    request(
      "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
    ),
  );
  assert.equal(info.browser, "Samsung Internet");
  assert.equal(info.browserVersion, "23.0");
  assert.equal(info.os, "Android");
  assert.equal(info.deviceType, "mobile");
});

test("stores only the country and ignores finer location headers", () => {
  const info = getUploaderInfo(
    request("Mozilla/5.0", {
      "cf-ipcountry": "ph",
      "cf-ipcity": "Manila",
      "cf-region": "Metro Manila",
      "cf-timezone": "Asia/Manila",
    }),
  );
  assert.equal(info.country, "PH");
  assert.equal(info.city, undefined);
  assert.equal(info.region, undefined);
  assert.equal(info.timezone, undefined);

  const visitor = getVisitorInfo(
    request("Mozilla/5.0", {
      "cf-ipcountry": "PH",
      "cf-ipcity": "Dasmariñas",
      "cf-region": "Cavite",
      "cf-timezone": "Asia/Manila",
    }),
  );
  assert.equal(visitor.country, "PH");
  assert.equal(visitor.city, undefined);
  assert.equal(visitor.region, undefined);
  assert.equal(visitor.timezone, undefined);
});

test("records only external referrer domains", () => {
  const external = getVisitorInfo(
    request("Mozilla/5.0", { "x-visitor-referrer": "https://example.com/page" }),
  );
  assert.equal(external.referrer, "example.com");

  const internal = getVisitorInfo(
    request("Mozilla/5.0", { referer: "https://site.com/share/0000" }),
  );
  assert.equal(internal.referrer, undefined);
});
