const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "pingvin-avatar-"));
process.env.DATA_DIRECTORY = dataDirectory;

const sharp = require("sharp");
const { AvatarService } = require("../dist/src/user/avatar.service.js");

function createService() {
  const updates = [];
  const prisma = {
    user: {
      update: async ({ where, data }) => {
        updates.push({ id: where.id, ...data });
        return { id: where.id, username: "alice", ...data };
      },
    },
  };
  return {
    service: new AvatarService(prisma, { t: (key) => key }),
    updates,
  };
}

async function makePng(width = 400, height = 200) {
  return await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 40, b: 40 },
    },
  })
    .png()
    .toBuffer();
}

test("stores a square WebP and records the version", async () => {
  const { service, updates } = createService();
  const userId = crypto.randomUUID();
  const png = await makePng();

  await service.save(userId, png);

  const stored = path.join(dataDirectory, "avatars", `${userId}.webp`);
  const metadata = await sharp(stored).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 256);
  assert.equal(metadata.height, 256);
  assert.equal(updates.length, 1);
  assert.ok(updates[0].avatarUpdatedAt instanceof Date);

  const file = await service.get(userId);
  assert.equal(file.path, stored);
  assert.ok(file.size > 0);
});

test("rejects bytes that are not a supported raster image", async () => {
  const { service } = createService();
  const userId = crypto.randomUUID();

  await assert.rejects(
    service.save(userId, Buffer.from("not an image")),
    (error) => error.getStatus() === 400,
  );
  await assert.rejects(
    service.save(
      userId,
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    ),
    (error) => error.getStatus() === 400,
  );
});

test("rejects uploads over the size limit before decoding", async () => {
  const { service } = createService();
  await assert.rejects(
    service.save(crypto.randomUUID(), Buffer.alloc(5 * 1024 * 1024 + 1)),
    (error) => error.getStatus() === 400,
  );
});

test("rejects a malformed user id instead of writing outside the directory", async () => {
  const { service } = createService();
  await assert.rejects(
    service.save("../../escape", await makePng()),
    (error) => error.getStatus() === 400,
  );
  assert.equal(await service.get("../../escape"), null);
});

test("removes the file and clears the version", async () => {
  const { service, updates } = createService();
  const userId = crypto.randomUUID();
  await service.save(userId, await makePng());

  const stored = path.join(dataDirectory, "avatars", `${userId}.webp`);
  assert.ok(fs.existsSync(stored));

  await service.remove(userId);
  assert.equal(fs.existsSync(stored), false);
  assert.equal(updates.at(-1).avatarUpdatedAt, null);
  assert.equal(await service.get(userId), null);
});
