const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const dataDirectory = path.join(
  os.tmpdir(),
  `pingvin-thumbnail-test-${process.pid}-${Date.now()}`,
);
process.env.DATA_DIRECTORY = dataDirectory;

const {
  findPreview,
  getPreviewCandidates,
} = require("../dist/src/share/preview.util.js");
const { FileService } = require("../dist/src/file/file.service.js");

test("prefers an image preview and still reports the share has a video", () => {
  const selection = findPreview([
    { id: "image", name: "photo.png" },
    { id: "video", name: "clip.mp4" },
  ]);

  assert.equal(selection.preview.id, "image");
  assert.equal(selection.preview.kind, "image");
  assert.equal(selection.hasVideo, true);
});

test("uses a playable video when the share has no image", () => {
  const selection = findPreview([
    { id: "unplayable", name: "clip.avi" },
    { id: "playable", name: "clip.webm" },
  ]);

  assert.equal(selection.preview.id, "playable");
  assert.equal(selection.preview.kind, "video");
  assert.equal(selection.hasVideo, true);
});

test("orders a corrupt first image before later thumbnail fallbacks", () => {
  const candidates = getPreviewCandidates([
    { id: "broken-image", name: "scan.bmp" },
    { id: "first-video", name: "clip.mp4" },
    { id: "second-image", name: "photo.jpg" },
    { id: "note", name: "note.txt" },
  ]);

  assert.deepEqual(
    candidates.map((candidate) => candidate.id),
    ["broken-image", "first-video", "second-image"],
  );
  assert.equal(candidates[0].kind, "image");
  assert.equal(candidates[1].kind, "video");
});

test("deletes share thumbnails older than thirty-two days", async () => {
  const thumbnailDirectory = path.join(
    dataDirectory,
    "uploads",
    "_thumbnails",
    "v300",
  );
  const oldPath = path.join(thumbnailDirectory, "old.webp");
  const newPath = path.join(thumbnailDirectory, "new.webp");
  await fs.mkdir(thumbnailDirectory, { recursive: true });
  await fs.writeFile(oldPath, "old");
  await fs.writeFile(newPath, "new");

  const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  await fs.utimes(oldPath, fortyDaysAgo, fortyDaysAgo);

  const service = Object.create(FileService.prototype);
  service.logger = { log: () => {} };
  const deleted = await service.cleanupShareThumbnails();

  assert.equal(deleted, 1);
  await assert.rejects(fs.stat(oldPath));
  assert.equal((await fs.stat(newPath)).isFile(), true);

  await fs.rm(dataDirectory, { recursive: true, force: true });
});
