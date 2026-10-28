const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

// constants.ts reads DATA_DIRECTORY when the module is first loaded, so point
// the sitemap writer at an isolated directory before requiring the service.
const DATA_DIRECTORY = fs.mkdtempSync(
  path.join(os.tmpdir(), "pingvin-sitemap-test-"),
);
process.env.DATA_DIRECTORY = DATA_DIRECTORY;

const { SystemService } = require("../dist/src/system/system.service.js");

const BASE_URL = "https://example.test";
const SITE_DIRECTORY = path.join(
  DATA_DIRECTORY,
  "sitemaps",
  crypto.createHash("sha256").update(BASE_URL).digest("hex").slice(0, 16),
);
const request = { headers: {}, socket: {} };

function resetSitemapDirectory() {
  fs.rmSync(SITE_DIRECTORY, { recursive: true, force: true });
}

function createService(shares = []) {
  let queries = 0;
  const prisma = {
    share: {
      findMany: async ({ take, cursor, skip }) => {
        queries += 1;
        let start = 0;
        if (cursor?.id) {
          start =
            shares.findIndex((share) => share.id === cursor.id) + (skip ?? 0);
        }
        return shares.slice(start, start + take);
      },
    },
  };
  const config = {
    get: (key) => (key === "general.appUrl" ? BASE_URL : undefined),
  };
  const service = new SystemService(config, prisma, {}, {});
  return { service, queries: () => queries };
}

function share(id, createdAt = new Date("2026-10-20T00:00:00.000Z")) {
  return { id, createdAt };
}

after(() => fs.rmSync(DATA_DIRECTORY, { recursive: true, force: true }));

test("writes a versioned sitemap index and chunks to disk", async () => {
  resetSitemapDirectory();
  const { service, queries } = createService([
    share("share-a"),
    share("share-b"),
  ]);

  const index = await service.getSitemapXml(request);
  assert.match(index, /<sitemapindex /);
  assert.match(
    index,
    /\/api\/system\/sitemaps\/sitemap-1\.xml\?v=[a-f0-9]{16}/,
  );

  const chunk = await service.getSitemapFile(request, "sitemap-1.xml");
  assert.match(chunk, /<urlset /);
  assert.equal((chunk.match(/<url>/g) ?? []).length, 5);

  assert.equal(queries(), 1);
  assert.deepEqual(fs.readdirSync(SITE_DIRECTORY).sort(), [
    "manifest.json",
    "sitemap-1.xml",
    "sitemap.xml",
  ]);

  // A fresh disk cache serves the index without another SQLite query.
  await service.getSitemapXml(request);
  assert.equal(queries(), 1);

  await assert.rejects(
    () => service.getSitemapFile(request, "../sitemap.xml"),
    (error) => error.name === "NotFoundException",
  );
});

test("serves an existing chunk without refreshing a stale manifest", async () => {
  resetSitemapDirectory();
  const built = createService([share("share-a")]);
  await built.service.getSitemapXml(request);
  assert.equal(built.queries(), 1);

  const manifestPath = path.join(SITE_DIRECTORY, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.generatedAt = new Date(0).toISOString();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));

  const reader = createService([share("share-a"), share("share-b")]);
  const chunk = await reader.service.getSitemapFile(request, "sitemap-1.xml");
  assert.match(chunk, /share-a/);
  assert.equal(reader.queries(), 0);

  // A missing chunk still triggers one rebuild before the 404.
  await assert.rejects(
    () => reader.service.getSitemapFile(request, "sitemap-2.xml"),
    (error) => error.name === "NotFoundException",
  );
  assert.equal(reader.queries(), 1);
});

test("adds versioned sitemap and crawlable chunk rules to robots.txt", async () => {
  resetSitemapDirectory();
  const { service } = createService([share("share-a")]);

  const robots = await service.getRobotsTxt(request);

  assert.match(
    robots,
    /Sitemap: https:\/\/example\.test\/sitemap\.xml\?v=[a-f0-9]{16}/,
  );
  assert.match(robots, /Allow: \/api\/system\/sitemaps\//);
  assert.match(robots, /Allow: \/sitemap\.xml/);
});

test("splits large sitemaps at 50,000 URL entries", async () => {
  resetSitemapDirectory();
  const shares = Array.from({ length: 50_001 }, (_, index) =>
    share(`s${String(index).padStart(6, "0")}`),
  );
  const { service } = createService(shares);

  await service.getSitemapXml(request);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(SITE_DIRECTORY, "manifest.json"), "utf8"),
  );

  assert.equal(manifest.files.length, 2);
  assert.equal(manifest.files[0].entries, 50_000);
  assert.equal(manifest.files[1].entries, 4);

  const first = await service.getSitemapFile(request, "sitemap-1.xml");
  const second = await service.getSitemapFile(request, "sitemap-2.xml");
  assert.equal((first.match(/<url>/g) ?? []).length, 50_000);
  assert.equal((second.match(/<url>/g) ?? []).length, 4);
});
