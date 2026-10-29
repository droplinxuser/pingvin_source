const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  detectFileHost,
  parseMediaFireHtml,
  resolveDropbox,
  resolveFileHost,
  resolveGoogleDrive,
  googleDriveFileId,
  oneDriveShareId,
  resolveOneDrive,
  resolvePixeldrain,
  resolveTmpFiles,
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
  const scrambled = Buffer.from(
    "https://evil.example.com/payload.bin",
  ).toString("base64");
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

test("detects the additional file hosts and their share domains", () => {
  assert.equal(
    detectFileHost("https://www.dropbox.com/s/abc/file.zip"),
    "dropbox",
  );
  assert.equal(detectFileHost("https://db.tt/abc"), "dropbox");
  assert.equal(
    detectFileHost("https://drive.google.com/file/d/xyz/view"),
    "gdrive",
  );
  assert.equal(
    detectFileHost("https://docs.google.com/document/d/xyz"),
    "gdrive",
  );
  assert.equal(detectFileHost("https://1drv.ms/u/s!abc"), "onedrive");
  assert.equal(
    detectFileHost("https://contoso-my.sharepoint.com/personal/u/file"),
    "onedrive",
  );
  assert.equal(
    detectFileHost("https://e.pcloud.link/publink/show?code=abc"),
    "pcloud",
  );
  assert.equal(detectFileHost("https://pc12.pcloud.com/x"), "pcloud");
  // Known but not resolvable without an account: still detected, not a direct URL.
  assert.equal(detectFileHost("https://mega.nz/file/abc#key"), "mega");
  assert.equal(detectFileHost("https://app.box.com/s/abc"), "box");
  assert.equal(detectFileHost("https://we.tl/t-abc"), "wetransfer");
  assert.equal(detectFileHost("https://www.fromsmash.com/abc"), "smash");
});

test("resolvable hosts without an account return unsupported", async () => {
  for (const url of [
    "https://mega.nz/file/abc#key",
    "https://app.box.com/s/abc",
    "https://we.tl/t-abc",
    "https://www.swisstransfer.com/d/abc",
    "https://fromsmash.com/abc",
    "https://www.filemail.com/d/abc",
    "https://www.icedrive.net/s/abc",
    "https://www.sync.com/s/abc",
    "https://drive.proton.me/urls/abc",
  ]) {
    await assert.rejects(
      () => resolveFileHost(url),
      (error) => error instanceof FileHostError && error.code === "unsupported",
      url,
    );
  }
});

test("Dropbox links download directly and folders are rejected", () => {
  const files = resolveDropbox("https://www.dropbox.com/s/abc/clip.mp4?dl=0");
  assert.equal(files.length, 1);
  assert.equal(new URL(files[0].url).searchParams.get("dl"), "1");
  assert.equal(files[0].name, "clip.mp4");
  assert.throws(
    () => resolveDropbox("https://www.dropbox.com/sh/abc/folder"),
    (error) => error instanceof FileHostError && error.code === "folder",
  );
});

test("Google Drive file ids are extracted from share URL shapes", () => {
  assert.equal(
    googleDriveFileId(
      "https://drive.google.com/file/d/FILEID123/view?usp=sharing",
    ),
    "FILEID123",
  );
  assert.equal(
    googleDriveFileId(
      "https://drive.google.com/uc?export=download&id=FILEID456",
    ),
    "FILEID456",
  );
  assert.equal(
    googleDriveFileId("https://drive.google.com/drive/folders/abc"),
    undefined,
  );
});

test("Google Drive resolves to the public download endpoint", () => {
  const files = resolveGoogleDrive(
    "https://drive.google.com/file/d/FILEID123/view",
  );
  assert.equal(files.length, 1);
  assert.match(files[0].url, /drive\.usercontent\.google\.com\/download\?/);
  assert.match(files[0].url, /id=FILEID123/);
  assert.throws(
    () => resolveGoogleDrive("https://drive.google.com/drive/folders/abc"),
    (error) => error instanceof FileHostError && error.code === "folder",
  );
});

test("OneDrive share URLs are base64url-encoded into the content API", () => {
  const share = "https://1drv.ms/u/s!abcDEF";
  const id = oneDriveShareId(share);
  assert.doesNotMatch(id, /[+/=]/);
  assert.equal(Buffer.from(id, "base64").toString("utf8"), share);
  const files = resolveOneDrive(share);
  assert.equal(files.length, 1);
  assert.equal(
    files[0].url,
    `https://api.onedrive.com/v1.0/shares/u!${id}/root/content`,
  );
});

test("Pixeldrain links resolve to the public download API", () => {
  assert.equal(
    detectFileHost("https://pixeldrain.com/u/abcd1234"),
    "pixeldrain",
  );
  const files = resolvePixeldrain("https://pixeldrain.com/u/abcd1234");
  assert.equal(files.length, 1);
  assert.equal(
    files[0].url,
    "https://pixeldrain.com/api/file/abcd1234?download",
  );
  // An already-direct API link is passed through unchanged.
  const direct = resolvePixeldrain(
    "https://pixeldrain.com/api/file/xyz?download",
  );
  assert.equal(direct[0].url, "https://pixeldrain.com/api/file/xyz?download");
  assert.throws(
    () => resolvePixeldrain("https://pixeldrain.com/l/abc"),
    (error) => error instanceof FileHostError && error.code === "folder",
  );
});

test("tmpfiles.org links resolve to the /dl/ download path", () => {
  assert.equal(detectFileHost("https://tmpfiles.org/12345/x.zip"), "tmpfiles");
  const files = resolveTmpFiles("https://tmpfiles.org/12345/report.pdf");
  assert.equal(files.length, 1);
  assert.equal(files[0].url, "https://tmpfiles.org/dl/12345/report.pdf");
  assert.equal(files[0].name, "report.pdf");
  assert.throws(
    () => resolveTmpFiles("https://tmpfiles.org/notanid"),
    (error) => error instanceof FileHostError && error.code === "unsupported",
  );
});
