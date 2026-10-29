const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// constants.ts reads DATA_DIRECTORY when first loaded, so isolate it before the
// report utility is required.
const DATA_DIRECTORY = fs.mkdtempSync(
  path.join(os.tmpdir(), "pingvin-vt-report-"),
);
process.env.DATA_DIRECTORY = DATA_DIRECTORY;

const {
  readVirusTotalReport,
  writeVirusTotalResult,
  removeVirusTotalResult,
  virusTotalReportPath,
} = require("../dist/src/virustotal/virustotalReport.util.js");

const SHARE_DIRECTORY = path.join(DATA_DIRECTORY, "uploads", "shares");

function ensureShare(shareId) {
  fs.mkdirSync(path.join(SHARE_DIRECTORY, shareId), { recursive: true });
}

const entry = (overrides = {}) => ({
  verdict: "clean",
  malicious: 0,
  suspicious: 0,
  harmless: 0,
  undetected: 62,
  engines: 62,
  hash: "2dd5611d811b9821234567890abcdef",
  scannedAt: new Date().toISOString(),
  ...overrides,
});

after(() => fs.rmSync(DATA_DIRECTORY, { recursive: true, force: true }));

test("writes and reads a per-share report beside the files", async () => {
  ensureShare("share-a");
  await writeVirusTotalResult("share-a", "file-1", entry());

  const report = await readVirusTotalReport("share-a");
  assert.equal(report["file-1"].undetected, 62);
  assert.equal(report["file-1"].verdict, "clean");

  const reportPath = virusTotalReportPath("share-a");
  assert.ok(reportPath && fs.existsSync(reportPath));
  assert.match(path.basename(reportPath), /virustotal\.json$/);
});

test("merges multiple files and can remove one entry", async () => {
  ensureShare("share-b");
  await writeVirusTotalResult("share-b", "file-1", entry());
  await writeVirusTotalResult(
    "share-b",
    "file-2",
    entry({ verdict: "suspicious", suspicious: 2, undetected: 60 }),
  );

  let report = await readVirusTotalReport("share-b");
  assert.deepEqual(Object.keys(report).sort(), ["file-1", "file-2"]);
  assert.equal(report["file-2"].verdict, "suspicious");

  await removeVirusTotalResult("share-b", "file-1");
  report = await readVirusTotalReport("share-b");
  assert.deepEqual(Object.keys(report), ["file-2"]);
});

test("is a no-op for a missing share directory or an invalid id", async () => {
  await writeVirusTotalResult("missing-share", "file-1", entry());
  assert.deepEqual(await readVirusTotalReport("missing-share"), {});

  await writeVirusTotalResult("../escape", "file-1", entry());
  assert.equal(virusTotalReportPath("../escape"), undefined);
  assert.deepEqual(await readVirusTotalReport("bad/id"), {});
});

test("ignores a corrupt report instead of throwing", async () => {
  ensureShare("share-c");
  fs.writeFileSync(virusTotalReportPath("share-c"), "{ not json");
  assert.deepEqual(await readVirusTotalReport("share-c"), {});
});
