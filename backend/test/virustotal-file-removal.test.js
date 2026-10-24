const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dataDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "pingvin-vt-remove-"),
);
process.env.DATA_DIRECTORY = dataDirectory;

const { ClamScanService } = require("../dist/src/clamscan/clamscan.service.js");

const shareId = "share-1";
const fileId = "file-1";
const fileName = "infected.zip";
const archivePath = path.join(
  dataDirectory,
  "uploads",
  "shares",
  shareId,
  "archive.zip",
);

function createService(remainingFiles) {
  const calls = {
    remove: [],
    deleteAll: [],
    updates: [],
    cacheDel: [],
  };
  const fileService = {
    getStorageProvider: async () => "LOCAL",
    remove: async (share, file) => {
      calls.remove.push([share, file]);
    },
    deleteAllFiles: async (share) => {
      calls.deleteAll.push(share);
    },
  };
  const prisma = {
    file: {
      count: async () => remainingFiles,
    },
    share: {
      update: async (args) => {
        calls.updates.push(args);
      },
    },
  };
  const cache = {
    del: async (key) => {
      calls.cacheDel.push(key);
    },
  };

  return {
    service: new ClamScanService(fileService, prisma, cache),
    calls,
  };
}

function writeArchive() {
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  fs.writeFileSync(archivePath, "stale zip");
}

test("removes only the offending file and keeps clean files", async () => {
  writeArchive();
  const { service, calls } = createService(2);

  const remaining = await service.removeMaliciousFile(
    shareId,
    fileId,
    fileName,
  );

  assert.equal(remaining, 2);
  assert.deepEqual(calls.remove, [[shareId, fileId]]);
  assert.deepEqual(calls.deleteAll, []);
  assert.equal(fs.existsSync(archivePath), false);
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.updates[0].data.isZipReady, false);
  assert.equal("removedReason" in calls.updates[0].data, false);
  assert.equal(calls.cacheDel.length, 2);
});

test("marks the share removed when the offending file was the last file", async () => {
  writeArchive();
  const { service, calls } = createService(0);

  const remaining = await service.removeMaliciousFile(
    shareId,
    fileId,
    fileName,
  );

  assert.equal(remaining, 0);
  assert.deepEqual(calls.remove, [[shareId, fileId]]);
  assert.deepEqual(calls.deleteAll, [shareId]);
  assert.equal(fs.existsSync(archivePath), false);
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.updates[0].data.isZipReady, false);
  assert.match(calls.updates[0].data.removedReason, /infected\.zip/);
  assert.equal(calls.cacheDel.length, 2);

  fs.rmSync(dataDirectory, { recursive: true, force: true });
});
