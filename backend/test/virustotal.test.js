const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const {
  shouldScanFile,
  parseAnalysisStats,
  getScanVerdict,
  parseRetryAfterMs,
} = require("../dist/src/virustotal/virustotal.util.js");
const {
  VirusTotalService,
} = require("../dist/src/virustotal/virustotal.service.js");

function createValkey() {
  const lists = new Map();
  const values = new Map();
  const client = {
    rPush: async (key, value) => {
      const list = lists.get(key) ?? [];
      list.push(value);
      lists.set(key, list);
      return list.length;
    },
    lTrim: async () => {},
    lPop: async (key) => {
      const list = lists.get(key) ?? [];
      return list.shift() ?? null;
    },
    set: async (key, value, options = {}) => {
      if (options.NX && values.has(key)) return null;
      values.set(key, value);
      return "OK";
    },
    get: async (key) => values.get(key) ?? null,
    pTTL: async (key) => (values.has(key) ? 173000 : -2),
  };

  return {
    values,
    valkey: { run: async (operation) => operation(client) },
  };
}

function createService(overrides = {}) {
  const content = Buffer.from("test payload");
  const removed = [];
  const removalReasons = [];
  const auditEvents = [];
  const auditCalls = [];
  const knownHashes = new Set();
  const emails = [];
  const valkeyMock = overrides.valkey ?? createValkey();
  const queue = overrides.queue ?? {
    jobs: [],
    push: async (job) => {
      queue.jobs.push(job);
    },
    pop: async () => queue.jobs.shift(),
    removeForShare: async (shareId) => {
      queue.jobs = queue.jobs.filter((job) => job.shareId !== shareId);
    },
    removeForFile: async (shareId, fileId) => {
      queue.jobs = queue.jobs.filter(
        (job) => job.shareId !== shareId || job.fileId !== fileId,
      );
    },
    getDepth: async () => ({ depth: queue.jobs.length, backend: "memory" }),
  };
  const audit = {
    recordApiCall: (kind) => auditCalls.push(kind),
    recordEvent: (event) => auditEvents.push(event),
    captureUploader: async () => ({
      anonymous: false,
      creator: {
        id: "user-1",
        username: "tester",
        displayName: "Test User",
        email: "tester@example.com",
      },
    }),
    isKnownMaliciousHash: async (hash) => knownHashes.has(hash),
    rememberMaliciousHash: async (hash) => knownHashes.add(hash),
  };
  const email = {
    sendMalwareRemovalEmail: async (...args) => {
      emails.push(args);
    },
  };
  const service = new VirusTotalService(
    {
      get: async () => ({ file: Readable.from([content]) }),
      exists: overrides.exists ?? (async () => true),
    },
    {
      removeMaliciousFile: async (shareId, fileId, fileNames, reason) => {
        removed.push({ shareId, fileId, fileNames });
        removalReasons.push(reason);
        return overrides.remainingFiles ?? 1;
      },
    },
    valkeyMock.valkey,
    audit,
    queue,
    email,
  );
  service.waitForRequestSlot = async () => true;
  service.running = true;

  return {
    service,
    content,
    removed,
    removalReasons,
    auditEvents,
    auditCalls,
    knownHashes,
    emails,
    valkey: valkeyMock,
    queue,
  };
}

const job = (overrides = {}) => ({
  stage: "lookup",
  shareId: "share-1",
  fileId: "file-1",
  name: "document.pdf",
  size: 1024,
  hash: "a".repeat(64),
  attempts: 0,
  ...overrides,
});

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("skips media and plain text but scans documents, archives and executables", () => {
  for (const name of [
    "photo.jpg",
    "image.png",
    "clip.mp4",
    "movie.mov",
    "song.mp3",
    "sound.wav",
    "notes.txt",
    "data.json",
    "feed.xml",
  ])
    assert.equal(shouldScanFile(name), false, name);

  for (const name of [
    "document.pdf",
    "report.docx",
    "archive.zip",
    "setup.exe",
    "program.jar",
    "vector.svg",
    "unknown.bin",
  ])
    assert.equal(shouldScanFile(name), true, name);
});

test("hashes a file and looks up its hash", async () => {
  const { service, content } = createService();
  const next = await service.hashJob(job({ stage: "hash", hash: undefined }));

  assert.equal(next.stage, "lookup");
  assert.equal(
    next.hash,
    crypto.createHash("sha256").update(content).digest("hex"),
  );
});

test("reuses a cached malicious verdict without an API request", async () => {
  const { service, content, removed, auditEvents } = createService();
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  await service.setVerdict(hash, "malicious");

  const next = await service.hashJob(job({ stage: "hash", hash: undefined }));
  assert.equal(next, undefined);
  assert.deepEqual(removed, [
    { shareId: "share-1", fileId: "file-1", fileNames: "document.pdf" },
  ]);
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].type, "malicious");
  assert.equal(auditEvents[0].removed, true);
  assert.match(auditEvents[0].detail, /1 clean file retained/);
  assert.equal(auditEvents[0].uploader.creator.username, "tester");
});

test("returns the clean verdict from a known file lookup", async () => {
  const { service, auditEvents, auditCalls } = createService();
  const originalFetch = global.fetch;
  global.fetch = async () =>
    jsonResponse({
      data: {
        attributes: {
          last_analysis_stats: { malicious: 0, suspicious: 0, harmless: 70 },
        },
      },
    });

  try {
    const next = await service.lookupJob(job());
    assert.equal(next, undefined);
    assert.equal(await service.getVerdict("a".repeat(64)), "clean");
  } finally {
    global.fetch = originalFetch;
  }
});

test("uploads an unknown file and starts polling its analysis", async () => {
  const { service, auditEvents } = createService();
  const originalFetch = global.fetch;
  let captured;
  global.fetch = async (_url, init) => {
    captured = init.body;
    return jsonResponse({ data: { id: "analysis-1" } });
  };

  try {
    const next = await service.uploadJob(job({ stage: "upload" }));
    assert.ok(captured instanceof FormData);
    assert.equal(next.stage, "analysis");
    assert.equal(next.analysisId, "analysis-1");
    assert.equal(auditEvents.at(-1).type, "uploaded");
    assert.equal(auditEvents.at(-1).analysisId, "analysis-1");
  } finally {
    global.fetch = originalFetch;
  }
});

test("removes only the offending file when the completed analysis is malicious", async () => {
  const {
    service,
    removed,
    removalReasons,
    auditEvents,
    knownHashes,
    emails,
  } = createService();
  const originalFetch = global.fetch;
  global.fetch = async () =>
    jsonResponse({
      data: {
        attributes: {
          status: "completed",
          stats: { malicious: 3, suspicious: 0, harmless: 50 },
        },
      },
    });

  try {
    const target = job({ stage: "analysis", analysisId: "analysis-1" });
    const next = await service.analysisJob(target);
    assert.equal(next, undefined);
    assert.deepEqual(removed, [
      { shareId: "share-1", fileId: "file-1", fileNames: "document.pdf" },
    ]);
    assert.match(removalReasons[0], /VirusTotal flagged/);
    assert.equal(knownHashes.has(target.hash), true);
    assert.deepEqual(emails, [
      [
        "tester@example.com",
        "share-1",
        "document.pdf",
        1,
        "Test User",
      ],
    ]);
    assert.equal(auditEvents.at(-1).type, "malicious");
    assert.equal(auditEvents.at(-1).removed, true);
    assert.match(auditEvents.at(-1).detail, /1 clean file retained/);
    assert.equal(auditEvents.at(-1).stats.malicious, 3);
  } finally {
    global.fetch = originalFetch;
  }
});

test("removes a permanently known malicious hash without an API call", async () => {
  const {
    service,
    content,
    removed,
    removalReasons,
    auditEvents,
    knownHashes,
    emails,
  } = createService();
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  knownHashes.add(hash);

  const originalFetch = global.fetch;
  let fetched = false;
  global.fetch = async () => {
    fetched = true;
    return jsonResponse({});
  };

  try {
    const next = await service.hashJob(job({ stage: "hash", hash: undefined }));
    assert.equal(next, undefined);
    assert.equal(fetched, false);
    assert.deepEqual(removed, [
      { shareId: "share-1", fileId: "file-1", fileNames: "document.pdf" },
    ]);
    assert.match(removalReasons[0], /VirusTotal flagged/);
    assert.equal(emails.length, 1);
    assert.equal(auditEvents.at(-1).type, "malicious");
    assert.equal(auditEvents.at(-1).cached, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("notifies the reverse-share owner when an anonymous upload is removed", async () => {
  const { service, auditEvents, emails } = createService({ remainingFiles: 0 });
  service.audit.captureUploader = async () => ({
    anonymous: true,
    reverseShareCreator: {
      id: "user-2",
      username: "owner",
      displayName: "Reverse Owner",
      email: "owner@example.com",
    },
  });
  service.audit.isKnownMaliciousHash = async () => true;

  const next = await service.hashJob(job({ stage: "hash", hash: undefined }));
  assert.equal(next, undefined);
  assert.deepEqual(emails, [
    [
      "owner@example.com",
      "share-1",
      "document.pdf",
      0,
      "Reverse Owner",
    ],
  ]);
  assert.equal(auditEvents.at(-1).type, "malicious");
});

test("sets a cooldown and keeps the job after HTTP 429", async () => {
  const { service, valkey, auditEvents } = createService();
  const originalFetch = global.fetch;
  global.fetch = async () =>
    jsonResponse({ error: { code: "QuotaExceededError" } }, 429, {
      "retry-after": "120",
    });

  try {
    const next = await service.lookupJob(job());
    assert.equal(next.stage, "lookup");
    assert.equal(next.attempts, 0);
    assert.equal(valkey.values.get("pingvin:virustotal:cooldown"), "1");
    assert.equal(auditEvents.at(-1).type, "rate_limited");
    assert.equal(auditEvents.at(-1).cooldownSeconds, 120);
  } finally {
    global.fetch = originalFetch;
  }
});

test("pauses scanning when the API key is rejected with HTTP 401", async () => {
  const { service, auditEvents } = createService();
  const originalFetch = global.fetch;
  global.fetch = async () =>
    jsonResponse({ error: { code: "WrongCredentialsError" } }, 401);

  try {
    const next = await service.lookupJob(job());
    assert.equal(next, undefined);
    assert.equal(service.running, false);
    assert.equal(service.authFailed, true);
    assert.equal(auditEvents.at(-1).type, "auth_error");
  } finally {
    global.fetch = originalFetch;
  }
});

test("keeps scanning after a per-operation HTTP 403", async () => {
  const { service, auditEvents } = createService();
  const originalFetch = global.fetch;
  global.fetch = async () =>
    jsonResponse({ error: { code: "ForbiddenError" } }, 403);

  try {
    const next = await service.lookupJob(job());
    assert.equal(next, undefined);
    assert.equal(service.running, true);
    assert.equal(service.authFailed, false);
    assert.equal(auditEvents.at(-1).type, "error");
    assert.equal(auditEvents.at(-1).detail, "HTTP 403");
  } finally {
    global.fetch = originalFetch;
  }
});

test("requests a large-file upload URL and streams files over 32 MB", async () => {
  const previousKey = process.env.VIRUSTOTAL_API_KEY;
  process.env.VIRUSTOTAL_API_KEY = "test-api-key";
  const { service, auditEvents } = createService();
  const originalFetch = global.fetch;
  const calls = [];
  let uploadedTo;
  let uploadedHeaders;
  service.postLargeUpload = async (url, form, headers) => {
    uploadedTo = url;
    uploadedHeaders = headers;
    return jsonResponse({ data: { id: "analysis-large" } });
  };
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    if (String(url).endsWith("/files/upload_url"))
      return jsonResponse({ data: "https://upload.example/large" });
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const next = await service.uploadJob(
      job({ stage: "upload", size: 40 * 1024 * 1024 }),
    );
    assert.equal(next.stage, "analysis");
    assert.equal(next.analysisId, "analysis-large");
    assert.deepEqual(calls, [
      {
        url: "https://www.virustotal.com/api/v3/files/upload_url",
        method: "GET",
      },
    ]);
    assert.equal(uploadedTo, "https://upload.example/large");
    assert.equal(uploadedHeaders["x-apikey"], "test-api-key");
    assert.equal(auditEvents.at(-1).type, "uploaded");
  } finally {
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.VIRUSTOTAL_API_KEY;
    else process.env.VIRUSTOTAL_API_KEY = previousKey;
  }
});

test("skips files above the 512 MB VirusTotal upload limit", async () => {
  const { service, auditEvents } = createService();
  const originalFetch = global.fetch;
  let requested = false;
  global.fetch = async () => {
    requested = true;
    return jsonResponse({});
  };

  try {
    const next = await service.uploadJob(
      job({ stage: "upload", size: 513 * 1024 * 1024 }),
    );
    assert.equal(next, undefined);
    assert.equal(requested, false);
    assert.equal(auditEvents.at(-1).type, "skipped");
    assert.match(auditEvents.at(-1).detail, /VirusTotal upload limit/);
  } finally {
    global.fetch = originalFetch;
  }
});
