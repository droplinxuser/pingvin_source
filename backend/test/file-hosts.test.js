const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  detectFileHost,
  parseMediaFireHtml,
  resolveFileHost,
  FileHostError,
} = require("../dist/src/utils/fileHosts.util.js");

test("detects the supported file hosts", () => {
  assert.equal(detectFileHost("https://gofile.io/d/mA8mGDxd"), "gofile");
  assert.equal(detectFileHost("https://www.gofile.io/d/x"), "gofile");
  assert.equal(detectFileHost("https://bunkr.cr/f/py8kk34NXl5Jl"), "bunkr");
  assert.equal(detectFileHost("https://bunkrr.su/f/abc"), "bunkr");
  assert.equal(detectFileHost("https://cdn.bunkr.cr/x"), "bunkr");
  assert.equal(
    detectFileHost("https://www.mediafire.com/file/abc/name/file"),
    "mediafire",
  );
  assert.equal(detectFileHost("https://example.com/file.zip"), null);
  assert.equal(detectFileHost("https://gofile.io.evil.com/d/x"), null);
  assert.equal(detectFileHost("not a url"), null);
});

test("parses a MediaFire scrambled download URL", () => {
  const direct = "https://download1234.mediafire.com/abcdef/report.pdf";
  const scrambled = Buffer.from(direct).toString("base64");
  const files = parseMediaFireHtml(
    `<a id="downloadButton" data-scrambled-url="${scrambled}">Download</a>`,
  );
  assert.equal(files.length, 1);
  assert.equal(files[0].url, direct);
  assert.equal(files[0].name, "report.pdf");
});

test("parses a MediaFire href download link", () => {
  const files = parseMediaFireHtml(
    `<a class="input popsok" href="https://download5.mediafire.com/x/y/clip.mp4">`,
  );
  assert.equal(files[0].url, "https://download5.mediafire.com/x/y/clip.mp4");
  assert.equal(files[0].name, "clip.mp4");
});

test("parses a MediaFire plain download URL", () => {
  const files = parseMediaFireHtml(
    `var x = 'https://download9.mediafire.com/q/w/archive.zip';`,
  );
  assert.equal(files[0].url, "https://download9.mediafire.com/q/w/archive.zip");
  assert.equal(files[0].name, "archive.zip");
});

test("rejects a MediaFire page without a download link", () => {
  assert.throws(
    () => parseMediaFireHtml("<html><body>login required</body></html>"),
    (error) => error instanceof FileHostError && error.code === "resolve",
  );
});

test("rejects a scrambled URL that points off MediaFire", () => {
  const scrambled = Buffer.from("https://evil.example.com/payload.bin").toString(
    "base64",
  );
  assert.throws(
    () =>
      parseMediaFireHtml(`<a data-scrambled-url="${scrambled}">Download</a>`),
    (error) => error instanceof FileHostError && error.code === "resolve",
  );
});

test("Gofile is reported as unsupported instead of circumventing it", async () => {
  await assert.rejects(
    () => resolveFileHost("https://gofile.io/d/mA8mGDxd"),
    (error) => error instanceof FileHostError && error.code === "gofile",
  );
});
