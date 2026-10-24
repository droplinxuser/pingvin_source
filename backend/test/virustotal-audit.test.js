const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dataDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "pingvin-vt-audit-"),
);
process.env.DATA_DIRECTORY = dataDirectory;

const {
  VirusTotalAuditService,
} = require("../dist/src/virustotal/virustotalAudit.service.js");

const stateFile = path.join(dataDirectory, "virustotal", "state.json");

function mockPrisma(share) {
  return {
    share: {
      findUnique: async () => share,
    },
  };
}

test("records calls and events in bounded file-backed state", async () => {
  const service = new VirusTotalAuditService(mockPrisma(null));
  await service.onModuleInit();

  service.recordApiCall("lookup");
  service.recordApiCall("lookup");
  service.recordApiCall("upload");
  service.recordApiCall("analysis");
  service.recordEvent({
    type: "queued",
    shareId: "share-1",
    fileId: "file-1",
    fileName: "document.pdf",
    size: 123,
  });
  service.recordEvent({
    type: "clean",
    shareId: "share-1",
    fileId: "file-1",
    fileName: "document.pdf",
    hash: "a".repeat(64),
    verdict: "clean",
    stats: { malicious: 0, suspicious: 0, harmless: 60, undetected: 4 },
  });
  service.recordEvent({
    type: "malicious",
    shareId: "share-2",
    fileId: "file-2",
    fileName: "infected.zip",
    hash: "b".repeat(64),
    verdict: "malicious",
    removed: true,
    stats: { malicious: 2, suspicious: 0, harmless: 1, undetected: 0 },
    uploader: {
      anonymous: false,
      creator: {
        id: "user-1",
        username: "tester",
        displayName: "Test User",
        email: "tester@example.com",
      },
      country: "PH",
      browser: "Chrome",
      os: "Linux",
    },
  });
  service.recordEvent({
    type: "error",
    shareId: "share-2",
    fileId: "file-2",
    fileName: "infected.zip",
    detail: "HTTP 500",
  });
  service.recordEvent({
    type: "rate_limited",
    shareId: "share-2",
    cooldownSeconds: 900,
  });
  service.recordEvent({
    type: "auth_error",
    shareId: "share-2",
    status: 401,
  });

  const overview = service.getOverview(10);
  assert.equal(overview.events.length, 6);
  assert.equal(overview.eventsTotal, 6);
  assert.equal(overview.stats.calls.lastHour, 4);
  assert.equal(overview.stats.calls.today, 4);
  assert.equal(overview.stats.calls.last24Hours, 4);
  assert.deepEqual(overview.stats.calls.byKindLast24Hours, {
    lookup: 2,
    upload: 1,
    analysis: 1,
  });
  assert.equal(overview.stats.scans.queued, 1);
  assert.equal(overview.stats.scans.clean, 1);
  assert.equal(overview.stats.scans.malicious, 1);
  assert.equal(overview.stats.scans.removed, 1);
  assert.equal(overview.stats.scans.errors, 1);
  assert.equal(overview.stats.scans.rateLimited, 1);
  assert.equal(overview.stats.scans.authErrors, 1);
  assert.equal(overview.storage, "virustotal/state.json");
  assert.equal(overview.events[0].type, "auth_error");
  const maliciousEvent = overview.events.find(
    (event) => event.type === "malicious",
  );
  assert.equal(maliciousEvent.uploader.creator.username, "tester");
  assert.equal(maliciousEvent.removed, true);

  await service.flush();
  const saved = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(saved.version, 1);
  assert.equal(saved.events.length, 6);
  assert.equal(saved.calls.length, 4);
  assert.equal(fs.statSync(stateFile).mode & 0o777, 0o600);

  const reloaded = new VirusTotalAuditService(mockPrisma(null));
  await reloaded.onModuleInit();
  const reloadedOverview = reloaded.getOverview(10);
  assert.equal(reloadedOverview.eventsTotal, 6);
  assert.equal(reloadedOverview.stats.calls.last24Hours, 4);
  const reloadedMalicious = reloadedOverview.events.find(
    (event) => event.type === "malicious",
  );
  assert.equal(reloadedMalicious.uploader.creator.email, "tester@example.com");

  await reloaded.onApplicationShutdown();
  await service.onApplicationShutdown();
});

test("captures registered and anonymous reverse-share uploaders", async () => {
  const service = new VirusTotalAuditService(
    mockPrisma({
      creator: {
        id: "user-1",
        username: "tester",
        displayName: "Test User",
        email: "tester@example.com",
      },
      reverseShare: {
        creator: {
          id: "user-2",
          username: "reverse-owner",
          displayName: null,
          email: "owner@example.com",
        },
      },
      createdAt: new Date("2026-10-24T12:00:00Z"),
    }),
  );
  await service.onModuleInit();

  const shareDirectory = path.join(
    dataDirectory,
    "uploads",
    "shares",
    "share-1",
  );
  fs.mkdirSync(shareDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(shareDirectory, "uploader.json"),
    JSON.stringify({
      country: "PH",
      city: "Manila",
      browser: "Chrome",
      os: "Linux",
      deviceType: "desktop",
      createdAt: "2026-10-24T12:00:00.000Z",
    }),
    { mode: 0o600 },
  );

  const registered = await service.captureUploader("share-1");
  assert.equal(registered.anonymous, false);
  assert.equal(registered.creator.username, "tester");
  assert.equal(registered.reverseShareCreator.username, "reverse-owner");
  assert.equal(registered.country, "PH");
  assert.equal(registered.browser, "Chrome");

  const anonymousService = new VirusTotalAuditService(
    mockPrisma({
      creator: null,
      reverseShare: {
        creator: {
          id: "user-2",
          username: "reverse-owner",
          displayName: null,
          email: "owner@example.com",
        },
      },
      createdAt: new Date("2026-10-24T12:00:00Z"),
    }),
  );
  await anonymousService.onModuleInit();
  const anonymous = await anonymousService.captureUploader("share-1");
  assert.equal(anonymous.anonymous, true);
  assert.equal(anonymous.creator, undefined);
  assert.equal(anonymous.reverseShareCreator.username, "reverse-owner");

  await anonymousService.onApplicationShutdown();
  await service.onApplicationShutdown();
});

test("caps retained events at two hundred", async () => {
  const service = new VirusTotalAuditService(mockPrisma(null));
  await service.onModuleInit();
  for (let index = 0; index < 205; index++) {
    service.recordEvent({
      type: "queued",
      shareId: "share-cap",
      fileId: `file-${index}`,
      fileName: `file-${index}.pdf`,
    });
  }
  const overview = service.getOverview(200);
  assert.equal(overview.eventsTotal, 200);
  assert.equal(overview.events.length, 200);
  await service.onApplicationShutdown();
  fs.rmSync(dataDirectory, { recursive: true, force: true });
});
