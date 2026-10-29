const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  checkBinary,
  checkTcp,
  extractVersion,
  getFfmpegCandidates,
} = require("../dist/src/utils/dependencies.util.js");

test("extracts a version token from tool output", () => {
  assert.equal(extractVersion("ffmpeg version 6.1.1 Copyright"), "6.1.1");
  assert.equal(extractVersion("ffmpeg version n9.0.2 Copyright"), "n9.0.2");
  assert.equal(extractVersion("2026.08.19\n"), "2026.08.19");
  assert.equal(extractVersion(""), undefined);
});

test("reports an installed binary and a missing one", async () => {
  const real = await checkBinary(process.execPath, ["--version"]);
  assert.equal(real.available, true);
  assert.ok(real.version);

  const missing = await checkBinary("pingvin-does-not-exist-xyz", [
    "--version",
  ]);
  assert.equal(missing.available, false);
});

test("tcp probe reports a closed port as unavailable", async () => {
  assert.equal(await checkTcp("127.0.0.1", 1, 500), false);
});

test("ffmpeg candidates include the PATH fallback", () => {
  assert.ok(getFfmpegCandidates().includes("ffmpeg"));
});
