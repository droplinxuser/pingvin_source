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
  const auditEvents = [];
  const auditCalls = [];
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
  };
  const service = new VirusTotalService(
    {
      get: async () => ({ file: Readable.from([content]) }),
      exists: overrides.exists ?? (async () => true),
    },
    {
      removeMaliciousFile: async (shareId, fileId, fileNames) => {
        removed.push({ shareId, fileId, fileNames });
        return 1;
      },
    },
    valkeyMock.valkey,
    audit,
    queue,
  );
  service.waitForRequestSlot = async () => true;
  service.running = true;

  return {
    service,
    content,
    removed,
    auditEvents,
    auditCalls,
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

test("parses VirusTotal stats and verdicts", () => {
  const malicious = parseAnalysisStats({
    last_analysis_stats: { malicious: 2, suspicious: 1, harmless: 60 },
  });
  assert.deepEqual(malicious, {
    malicious: 2,
    suspicious: 1,
    harmless: 60,
    undetected: 0,
  });
  assert.equal(getScanVerdict(malicious), "malicious");

  const suspicious = parseAnalysisStats({
    stats: { malicious: 0, suspicious: 2, harmless: 60 },
  });
  assert.equal(getScanVerdict(suspicious), "suspicious");

  const clean = parseAnalysisStats({
    last_analysis_stats: { malicious: 0, suspicious: 0, undetected: 60 },
  });
  assert.equal(getScanVerdict(clean), "clean");
  assert.equal(getScanVerdict(undefined), undefined);
  assert.equal(parseAnalysisStats({}), undefined);
});

test("honours Retry-After seconds and dates", () => {
  assert.equal(parseRetryAfterMs("120", 1, 3600000), 120000);
  assert.equal(parseRetryAfterMs("0", 60000, 3600000), 60000);
  assert.equal(parseRetryAfterMs("999999", 1, 3600000), 3600000);
  assert.equal(parseRetryAfterMs(null, 900000, 3600000), 900000);
});

test("queues and pops a scan job through Valkey", async () => {
  const { service } = createService();
  await service.pushJob(job());

  const next = await service.nextJob();
  assert.equal(next.stage, "lookup");
  assert.equal(next.shareId, "share-1");
  assert.equal(next.size, 1024);
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
  const { service, removed, auditEvents } = createService();
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
    const next = await service.analysisJob(
      job({ stage: "analysis", analysisId: "analysis-1" }),
    );
    assert.equal(next, undefined);
    assert.deepEqual(removed, [
      { shareId: "share-1", fileId: "file-1", fileNames: "document.pdf" },
    ]);
    assert.equal(auditEvents.at(-1).type, "malicious");
    assert.equal(auditEvents.at(-1).removed, true);
    assert.match(auditEvents.at(-1).detail, /1 clean file retained/);
    assert.equal(auditEvents.at(-1).stats.malicious, 3);
  } finally {
    global.fetch = originalFetch;
  }
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

test("drops a queued job when the file or share was deleted", async () => {
  const { service, auditEvents, auditCalls } = createService({
    exists: async () => false,
  });
  const originalFetch = global.fetch;
  let requested = false;
  global.fetch = async () => {
    requested = true;
    return jsonResponse({});
  };

  try {
    const next = await service.processJob(job());
    assert.equal(next, undefined);
    assert.equal(requested, false);
    assert.equal(auditCalls.length, 0);
    assert.equal(auditEvents.at(-1).type, "dropped");
    assert.match(auditEvents.at(-1).detail, /deleted before the scan/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("requests a large-file upload URL and streams files over 32 MB", async () => {
  const { service, auditEvents } = createService();
  const originalFetch = global.fetch;
  const calls = [];
  let uploadedTo;
  service.postLargeUpload = async (url) => {
    uploadedTo = url;
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
    assert.equal(auditEvents.at(-1).type, "uploaded");
  } finally {
    global.fetch = originalFetch;
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

test("removes queued work for a deleted share or file", async () => {
  const { service, queue } = createService();
  queue.jobs.push(
    job({ shareId: "share-1", fileId: "file-1" }),
    job({ shareId: "share-1", fileId: "file-2" }),
    job({ shareId: "share-2", fileId: "file-3" }),
  );

  await service.removeJobsForFile("share-1", "file-1");
  assert.deepEqual(
    queue.jobs.map((item) => `${item.shareId}/${item.fileId}`),
    ["share-1/file-2", "share-2/file-3"],
  );

  await service.removeJobsForShare("share-1");
  assert.deepEqual(
    queue.jobs.map((item) => `${item.shareId}/${item.fileId}`),
    ["share-2/file-3"],
  );
});
