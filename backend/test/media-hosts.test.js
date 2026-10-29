const { test } = require("node:test");
const assert = require("node:assert/strict");

const { detectMediaHost } = require("../dist/src/utils/mediaHosts.util.js");

test("detects the allowlisted media platforms", () => {
  assert.equal(
    detectMediaHost("https://www.youtube.com/watch?v=abc"),
    "www.youtube.com",
  );
  assert.equal(detectMediaHost("https://youtu.be/abc"), "youtu.be");
  assert.equal(detectMediaHost("https://vimeo.com/12345"), "vimeo.com");
  assert.equal(detectMediaHost("https://dai.ly/abc"), "dai.ly");
  assert.equal(
    detectMediaHost("https://www.reddit.com/r/x/comments/y/z/"),
    "www.reddit.com",
  );
  assert.equal(detectMediaHost("https://v.redd.it/abc"), "v.redd.it");
  // Suffix-matched platforms (user/CDN subdomains).
  assert.equal(
    detectMediaHost("https://artist.bandcamp.com/track/x"),
    "artist.bandcamp.com",
  );
  assert.equal(
    detectMediaHost("https://www.bitchute.com/video/abc"),
    "www.bitchute.com",
  );
});

test("rejects unknown, spoofed and non-http hosts", () => {
  assert.equal(detectMediaHost("https://example.com/video"), null);
  assert.equal(detectMediaHost("https://youtube.com.evil.com/x"), null);
  assert.equal(detectMediaHost("https://notyoutube.com/x"), null);
  // Internal/private addresses must never reach yt-dlp.
  assert.equal(detectMediaHost("http://127.0.0.1:8080/x"), null);
  assert.equal(
    detectMediaHost("http://169.254.169.254/latest/meta-data"),
    null,
  );
  assert.equal(detectMediaHost("file:///etc/passwd"), null);
  assert.equal(detectMediaHost("not a url"), null);
});
