const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  isBlockedIp,
  downloadRemoteToFile,
  RemoteFetchError,
} = require("../dist/src/utils/remoteFetch.util.js");

test("blocks private, loopback, link-local and reserved addresses", () => {
  for (const ip of [
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.10.10",
    "172.16.5.5",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
  ]) {
    assert.equal(isBlockedIp(ip), true, `${ip} should be blocked`);
  }
});

test("allows ordinary public addresses", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700::1111"]) {
    assert.equal(isBlockedIp(ip), false, `${ip} should be allowed`);
  }
});

test("rejects unsupported protocols before any connection", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pingvin-remote-"));
  const dest = path.join(dir, "out");
  await assert.rejects(
    () => downloadRemoteToFile("ftp://example.com/file", dest, { maxBytes: 100 }),
    (error) => error instanceof RemoteFetchError && error.reason === "blocked",
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("rejects a URL with embedded credentials", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pingvin-remote-"));
  const dest = path.join(dir, "out");
  await assert.rejects(
    () =>
      downloadRemoteToFile("http://user:pass@example.com/file", dest, {
        maxBytes: 100,
      }),
    (error) => error instanceof RemoteFetchError && error.reason === "blocked",
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("rejects a loopback host without connecting", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pingvin-remote-"));
  const dest = path.join(dir, "out");
  await assert.rejects(
    () => downloadRemoteToFile("http://127.0.0.1/secret", dest, { maxBytes: 100 }),
    (error) => error instanceof RemoteFetchError && error.reason === "blocked",
  );
  fs.rmSync(dir, { recursive: true, force: true });
});
