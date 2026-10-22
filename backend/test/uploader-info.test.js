const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getUploaderInfo,
  getVisitorInfo,
} = require("../dist/src/utils/uploaderInfo.util.js");

const request = (userAgent, headers = {}) => ({
  headers: { "user-agent": userAgent, ...headers },
  hostname: "dropmb.com",
});

test("handles requests without a user agent", () => {
  const info = getUploaderInfo(request(undefined));
  assert.equal(info.browser, undefined);
  assert.equal(info.os, undefined);
  assert.equal(info.deviceType, "desktop");
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

test("records only external referrer domains", () => {
  const external = getVisitorInfo(
    request("Mozilla/5.0", { "x-visitor-referrer": "https://example.com/page" }),
  );
  assert.equal(external.referrer, "example.com");

  const internal = getVisitorInfo(
    request("Mozilla/5.0", { referer: "https://dropmb.com/share/0000" }),
  );
  assert.equal(internal.referrer, undefined);
});
