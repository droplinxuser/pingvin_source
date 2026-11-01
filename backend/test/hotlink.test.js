const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isRequestFromApp,
  redirectToSharePage,
} = require("../dist/src/utils/referrer.util.js");

const request = (referer, host = "files.example.com") => ({
  headers: referer === undefined ? { host } : { host, referer },
});

test("accepts a same-origin referrer even with the placeholder app URL", () => {
  assert.equal(
    isRequestFromApp(
      request("https://files.example.com/share/abc"),
      "http://localhost:3000",
    ),
    true,
  );
});

test("accepts a same-origin referrer over an alias host", () => {
  assert.equal(
    isRequestFromApp(
      request("http://192.168.1.20:3000/share/abc", "192.168.1.20:3000"),
      "https://files.example.com",
    ),
    true,
  );
});

test("accepts the configured app host and path behind a proxy host", () => {
  // The proxy may forward a different Host header, so the configured app URL
  // is the only hint that the referrer belongs to this instance.
  assert.equal(
    isRequestFromApp(
      request("https://files.example.com/files/share/abc", "internal:8080"),
      "https://files.example.com/files",
    ),
    true,
  );
  assert.equal(
    isRequestFromApp(
      request("https://files.example.com/other", "internal:8080"),
      "https://files.example.com/files",
    ),
    false,
  );
});

test("rejects a foreign referrer", () => {
  assert.equal(
    isRequestFromApp(
      request("https://hotlink.example.org/embed"),
      "https://files.example.com",
    ),
    false,
  );
});

test("rejects a missing or malformed referrer", () => {
  assert.equal(isRequestFromApp(request(undefined), "https://files.example.com"), false);
  assert.equal(isRequestFromApp(request("not a url"), "https://files.example.com"), false);
});

const redirect = (appUrl) => {
  const headers = {};
  const res = {
    statusCode: 0,
    status(code) {
      this.statusCode = code;
      return this;
    },
    set(values) {
      Object.assign(headers, values);
      return this;
    },
  };
  redirectToSharePage(res, appUrl, "abc");
  return { res, headers };
};

test("redirects to a relative share location without caching", () => {
  const { res, headers } = redirect("http://localhost:3000");
  assert.equal(res.statusCode, 302);
  assert.equal(headers.Location, "/share/abc");
  assert.match(headers["Cache-Control"], /no-store/);
});

test("keeps a configured sub-path in the redirect location", () => {
  const { headers } = redirect("https://files.example.com/files/");
  assert.equal(headers.Location, "/files/share/abc");
});
