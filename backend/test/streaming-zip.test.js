const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");

// constants.ts reads DATA_DIRECTORY at module load; point it at an isolated
// directory before requiring the services.
const DATA_DIRECTORY = fs.mkdtempSync(path.join(os.tmpdir(), "pingvin-zip-"));
process.env.DATA_DIRECTORY = DATA_DIRECTORY;

const { FileService } = require("../dist/src/file/file.service.js");
const { LocalFileService } = require("../dist/src/file/local.service.js");

const SHARES_DIRECTORY = path.join(DATA_DIRECTORY, "uploads", "shares");

async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test("streams a real ZIP without leaving an archive on disk", async () => {
  const shareId = "zipshare";
  const fileId = "11111111-1111-1111-1111-111111111111";
  const directory = path.join(SHARES_DIRECTORY, shareId);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, fileId), "hello zip world");

  const service = new LocalFileService({}, { get: () => "9" }, { t: (k) => k });

  const buffer = await collect(
    await service.getZip(shareId, [{ id: fileId, name: "hello.txt" }]),
  );

  assert.equal(buffer.subarray(0, 2).toString(), "PK");
  assert.ok(buffer.includes(Buffer.from("hello.txt")));
  // The archive is streamed, never written next to the files.
  assert.equal(fs.existsSync(path.join(directory, "archive.zip")), false);

  fs.rmSync(directory, { recursive: true, force: true });
});

test("skips a file whose bytes are missing instead of failing the archive", async () => {
  const shareId = "zipshare-missing";
  const directory = path.join(SHARES_DIRECTORY, shareId);
  fs.mkdirSync(directory, { recursive: true });

  const service = new LocalFileService({}, { get: () => "9" }, { t: (k) => k });

  const buffer = await collect(
    await service.getZip(shareId, [{ id: "missing", name: "missing.txt" }]),
  );

  // A valid (empty) ZIP is still produced.
  assert.equal(buffer.subarray(0, 2).toString(), "PK");

  fs.rmSync(directory, { recursive: true, force: true });
});

function buildFileService({ files, totalSize, maxZipSize, storageProvider }) {
  let selectedFilter;
  let passedFiles;
  const local = {
    getZip: async (_shareId, selected) => {
      passedFiles = selected;
      return Readable.from([Buffer.from("zip")]);
    },
  };
  const prisma = {
    file: {
      findMany: async (args) => {
        selectedFilter = args?.where?.id?.in;
        return files;
      },
    },
    share: { findFirst: async () => ({ storageProvider: storageProvider }) },
  };
  const config = {
    get: (key) => {
      if (key === "share.maxZipSize") return String(maxZipSize);
      if (key === "s3.enabled") return false;
      if (key === "share.zipCompressionLevel") return "9";
      return undefined;
    },
  };
  const service = new FileService(
    prisma,
    local,
    {},
    config,
    {},
    { t: (k) => k },
    {},
    {},
    {},
    {},
  );
  return {
    service,
    getPassedFiles: () => passedFiles,
    getSelectedFilter: () => selectedFilter,
  };
}

test("rejects a selection larger than the ZIP size cap", async () => {
  const { service } = buildFileService({
    files: [
      { id: "a", name: "a.bin", size: "400" },
      { id: "b", name: "b.bin", size: "400" },
    ],
    maxZipSize: 500,
    storageProvider: "LOCAL",
  });

  await assert.rejects(
    () => service.getZip("share", "LOCAL"),
    (error) => error.getStatus() === 413,
  );
});

test("streams a ZIP when the selection fits the cap", async () => {
  const { service, getPassedFiles } = buildFileService({
    files: [
      { id: "a", name: "a.bin", size: "100" },
      { id: "b", name: "b.bin", size: "100" },
    ],
    maxZipSize: 500,
    storageProvider: "LOCAL",
  });

  const stream = await service.getZip("share", "LOCAL");
  assert.equal(getPassedFiles().length, 2);
  assert.equal(await collect(stream).then((b) => b.toString()), "zip");
});

test("passes a subset filter through to the file query", async () => {
  const { service, getSelectedFilter } = buildFileService({
    files: [{ id: "a", name: "a.bin", size: "100" }],
    maxZipSize: 500,
    storageProvider: "LOCAL",
  });

  await service.getZip("share", "LOCAL", ["a"]);
  assert.deepEqual(getSelectedFilter(), ["a"]);
});
