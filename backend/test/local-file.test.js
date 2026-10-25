const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// constants.ts reads DATA_DIRECTORY at module load; point it at an isolated
// directory before requiring the storage service.
const DATA_DIRECTORY = fs.mkdtempSync(
  path.join(os.tmpdir(), "pingvin-local-file-"),
);
process.env.DATA_DIRECTORY = DATA_DIRECTORY;

const { LocalFileService } = require("../dist/src/file/local.service.js");

test("returns 404 instead of crashing when a file's bytes are missing", async () => {
  const service = new LocalFileService(
    {
      file: {
        findFirst: async () => ({
          id: "missing",
          name: "missing.jpg",
          size: "10",
          shareId: "share",
        }),
      },
    },
    {},
    { t: (key) => key },
  );

  await assert.rejects(
    () => service.get("share", "missing"),
    (error) => error.getStatus() === 404,
  );

  fs.rmSync(DATA_DIRECTORY, { recursive: true, force: true });
});
