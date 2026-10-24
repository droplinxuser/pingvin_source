import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from "@nestjs/common";
import * as crypto from "crypto";
import { Readable } from "stream";
import { ValkeyService } from "src/cache/valkey.service";
import { ClamScanService } from "src/clamscan/clamscan.service";
import { FileService } from "src/file/file.service";
import { VirusTotalAuditService } from "./virustotalAudit.service";
import {
  AnalysisStats,
  ScanVerdict,
  getScanVerdict,
  parseAnalysisStats,
  parseRetryAfterMs,
  sha256Stream,
  shouldScanFile,
} from "./virustotal.util";

const API_BASE_DEFAULT = "https://www.virustotal.com/api/v3";
const RATE_LIMIT_MS = 3 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30 * 1000;
const UPLOAD_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;
const MAX_ATTEMPTS = 3;
const MAX_ANALYSIS_POLLS = 20;
const IDLE_MS = 5 * 1000;
const MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_FALLBACK_MS = 15 * 60 * 1000;
const VERDICT_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_QUEUE_JOBS = 1000;
const MAX_MEMORY_VERDICTS = 1000;

const QUEUE_KEY = "pingvin:virustotal:queue";
const REQUEST_LOCK_KEY = "pingvin:virustotal:request";
const COOLDOWN_KEY = "pingvin:virustotal:cooldown";
const VERDICT_KEY_PREFIX = "pingvin:virustotal:verdict:";

type VirusTotalResponse = {
  data?: {
    id?: string;
    attributes?: Record<string, unknown>;
  };
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "unknown error";
}

type ScanStage = "hash" | "lookup" | "upload" | "analysis";

type ScanJob = {
  stage: ScanStage;
  shareId: string;
  fileId: string;
  name: string;
  size: number;
  hash?: string;
  analysisId?: string;
  attempts: number;
  submissions?: number;
};

export type VirusTotalShare = {
  id: string;
  files: { id: string; name: string; size: string }[];
};

/**
 * Best-effort VirusTotal scanning for completed shares.
 *
 * Every step is queued and executed by one background loop. A Valkey lock
 * spaces API calls three minutes apart across restarts and instances; the
 * queue itself also lives in Valkey so a restart does not lose pending work.
 * If Valkey is unavailable the service falls back to a process-memory queue
 * and the same local three-minute spacing.
 */
@Injectable()
export class VirusTotalService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(VirusTotalService.name);
  private readonly apiKey = (process.env.VIRUSTOTAL_API_KEY || "").trim();
  private readonly apiBase = (
    process.env.VIRUSTOTAL_API_URL || API_BASE_DEFAULT
  ).replace(/\/+$/, "");
  private readonly instanceId = crypto.randomUUID();
  private readonly memoryQueue: ScanJob[] = [];
  private readonly memoryVerdicts = new Map<
    string,
    { verdict: ScanVerdict; expiresAt: number }
  >();

  private running = false;
  private authFailed = false;
  private loggedMemoryFallback = false;
  private loopPromise?: Promise<void>;
  private currentAbort?: AbortController;
  private currentStream?: Readable;
  private currentJob?: ScanJob;
  private currentJobStartedAt = 0;
  private lastRequestAt = 0;
  private lastRequestKind?: "lookup" | "upload" | "analysis";
  private cooldownUntil = 0;
  private wakeResolve?: () => void;
  private wakeTimer?: NodeJS.Timeout;

  constructor(
    private readonly fileService: FileService,
    private readonly clamScanService: ClamScanService,
    private readonly valkey: ValkeyService,
    private readonly audit: VirusTotalAuditService,
  ) {}

  onModuleInit() {
    if (!this.apiKey) {
      this.logger.log(
        "VirusTotal scanning is disabled (VIRUSTOTAL_API_KEY is not set)",
      );
      return;
    }

    this.running = true;
    this.logger.log(
      "VirusTotal scanning is enabled (one API request per 3 minutes)",
    );
    this.loopPromise = this.loop().catch((error) => {
      this.running = false;
      this.logger.error(`VirusTotal worker stopped: ${errorMessage(error)}`);
    });
  }

  onApplicationShutdown() {
    this.running = false;
    this.wake();
    this.currentAbort?.abort();
    this.currentStream?.destroy();
    this.currentStream = undefined;
    return this.loopPromise;
  }

  /**
   * Queues the files of a completed share without blocking the request. Safe
   * image/audio/video types are filtered before anything is read from storage.
   */
  scanShare(share: VirusTotalShare) {
    if (!this.apiKey || this.authFailed) return;

    const files = share.files.filter((file) => shouldScanFile(file.name));
    if (files.length === 0) return;

    void this.enqueue(share.id, files).catch((error) => {
      this.logger.warn(
        `VirusTotal could not queue share ${share.id}: ${errorMessage(error)}`,
      );
    });
  }

  private async enqueue(
    shareId: string,
    files: { id: string; name: string; size: string }[],
  ) {
    for (const file of files) {
      if (!this.running) return;
      await this.pushJob({
        stage: "hash",
        shareId,
        fileId: file.id,
        name: file.name,
        size: Number(file.size) || 0,
        attempts: 0,
      });
      this.audit.recordEvent({
        type: "queued",
        shareId,
        fileId: file.id,
        fileName: file.name,
        size: Number(file.size) || 0,
      });
    }
  }

  private async pushJob(job: ScanJob) {
    const payload = JSON.stringify(job);
    const length = await this.valkey.run((client) =>
      client.rPush(QUEUE_KEY, payload),
    );

    if (length === undefined) {
      if (this.memoryQueue.length >= MAX_QUEUE_JOBS) this.memoryQueue.shift();
      this.memoryQueue.push(job);
      if (!this.loggedMemoryFallback) {
        this.loggedMemoryFallback = true;
        this.logger.warn(
          "VirusTotal queue is using process memory because Valkey is unavailable",
        );
      }
    } else {
      this.loggedMemoryFallback = false;
      // Keep newest work instead of letting a large backlog occupy Valkey
      // indefinitely. The trim is best-effort; the push already succeeded.
      if (length > MAX_QUEUE_JOBS)
        void this.valkey.run((client) =>
          client.lTrim(QUEUE_KEY, -MAX_QUEUE_JOBS, -1),
        );
    }
  }

  private async nextJob(): Promise<ScanJob | undefined> {
    const local = this.memoryQueue.shift();
    if (local) return local;

    const raw = await this.valkey.run((client) => client.lPop(QUEUE_KEY));
    if (typeof raw !== "string") return undefined;

    try {
      const parsed = JSON.parse(raw);
      if (
        !parsed ||
        !["hash", "lookup", "upload", "analysis"].includes(parsed.stage) ||
        typeof parsed.shareId !== "string" ||
        typeof parsed.fileId !== "string" ||
        typeof parsed.name !== "string"
      )
        return undefined;
      if (parsed.stage !== "hash" && typeof parsed.hash !== "string")
        return undefined;
      if (parsed.stage === "analysis" && typeof parsed.analysisId !== "string")
        return undefined;

      return {
        ...parsed,
        size: Number(parsed.size) || 0,
        attempts: Number(parsed.attempts) || 0,
        submissions: Number(parsed.submissions) || 0,
      };
    } catch {
      return undefined;
    }
  }

  private async loop() {
    while (this.running) {
      const job = await this.nextJob();
      if (!job) {
        if (!this.running) break;
        await this.sleep(IDLE_MS);
        continue;
      }

      let requeue: ScanJob | undefined;
      this.currentJob = job;
      this.currentJobStartedAt = Date.now();
      try {
        requeue = await this.processJob(job);
      } catch (error) {
        this.audit.recordEvent({
          type: "error",
          stage: job.stage,
          ...this.jobEvent(job),
          detail: errorMessage(error),
        });
        this.logger.warn(
          `VirusTotal job failed for share ${job.shareId}: ${errorMessage(error)}`,
        );
        requeue = this.retry(job, errorMessage(error));
      } finally {
        this.currentJob = undefined;
      }
      if (requeue) await this.pushJob(requeue);
    }
  }

  private jobEvent(job: ScanJob) {
    return {
      shareId: job.shareId,
      fileId: job.fileId,
      fileName: job.name,
      size: job.size,
      hash: job.hash,
    };
  }

  private async processJob(job: ScanJob): Promise<ScanJob | undefined> {
    switch (job.stage) {
      case "hash":
        return this.hashJob(job);
      case "lookup":
        return this.lookupJob(job);
      case "upload":
        return this.uploadJob(job);
      case "analysis":
        return this.analysisJob(job);
    }
  }

  private async hashJob(job: ScanJob): Promise<ScanJob | undefined> {
    let stream: Readable | undefined;
    try {
      const file = await this.fileService.get(job.shareId, job.fileId);
      stream = file.file;
      if (!stream) return undefined;
      this.currentStream = stream;

      const hash = await sha256Stream(stream);
      const cached = await this.getVerdict(hash);
      if (cached === "malicious") {
        const uploader = await this.audit.captureUploader(job.shareId);
        const removed = await this.removeMaliciousShare(job);
        this.audit.recordEvent({
          type: "malicious",
          ...this.jobEvent(job),
          hash,
          verdict: "malicious",
          cached: true,
          removed,
          uploader,
        });
        return undefined;
      }
      if (cached) {
        this.audit.recordEvent({
          type: cached,
          ...this.jobEvent(job),
          hash,
          verdict: cached,
          cached: true,
        });
        return undefined;
      }

      return { ...job, stage: "lookup", hash, attempts: 0 };
    } catch (error) {
      stream?.destroy();
      this.logger.debug(
        `VirusTotal could not hash ${job.shareId}/${job.fileId}: ${errorMessage(error)}`,
      );
      return undefined;
    } finally {
      stream?.destroy();
      if (this.currentStream === stream) this.currentStream = undefined;
    }
  }

  private async lookupJob(job: ScanJob): Promise<ScanJob | undefined> {
    if (!(await this.waitForRequestSlot())) return job;

    const response = await this.fetchApi(
      `/files/${encodeURIComponent(job.hash)}`,
      {},
      REQUEST_TIMEOUT_MS,
    );
    if (!response) return this.networkError(job, "lookup");

    if (response.status === 200) {
      const body = await this.readJson(response);
      const stats = parseAnalysisStats(body?.data?.attributes);
      const verdict = getScanVerdict(stats);

      if (await this.applyVerdict(job, stats, verdict)) return undefined;

      // The file is known but has no usable analysis yet; submit it again.
      return this.beginUpload(job);
    }

    if (response.status === 404) return this.beginUpload(job);
    return this.handleResponseError(job, response, "lookup");
  }

  private beginUpload(job: ScanJob): ScanJob | undefined {
    const submissions = job.submissions ?? 0;
    if (submissions >= MAX_ATTEMPTS) {
      this.audit.recordEvent({
        type: "dropped",
        stage: "upload",
        ...this.jobEvent(job),
        detail: `Upload submission limit reached (${MAX_ATTEMPTS})`,
      });
      this.logger.warn(
        `VirusTotal dropped ${job.name} after ${MAX_ATTEMPTS} upload attempts`,
      );
      return undefined;
    }
    if (job.size > MAX_UPLOAD_BYTES) {
      this.audit.recordEvent({
        type: "skipped",
        stage: "upload",
        ...this.jobEvent(job),
        detail: "File exceeds the free-tier upload limit",
      });
      this.logger.log(
        `VirusTotal skipped ${job.name}: file exceeds the free-tier upload limit`,
      );
      return undefined;
    }
    return {
      ...job,
      stage: "upload",
      attempts: 0,
      submissions: submissions + 1,
    };
  }

  private async uploadJob(job: ScanJob): Promise<ScanJob | undefined> {
    if (job.size > MAX_UPLOAD_BYTES) {
      this.audit.recordEvent({
        type: "skipped",
        stage: "upload",
        ...this.jobEvent(job),
        detail: "File exceeds the free-tier upload limit",
      });
      return undefined;
    }
    if (!(await this.waitForRequestSlot())) return job;

    let buffer: Buffer;
    try {
      buffer = await this.readFileBuffer(job);
    } catch (error) {
      this.audit.recordEvent({
        type: "error",
        stage: "upload",
        ...this.jobEvent(job),
        detail: errorMessage(error),
      });
      this.logger.warn(
        `VirusTotal could not read ${job.name}: ${errorMessage(error)}`,
      );
      return undefined;
    }

    const form = new FormData();
    form.append(
      "file",
      new Blob([buffer], { type: "application/octet-stream" }),
      job.name || job.fileId,
    );

    const response = await this.fetchApi(
      "/files",
      { method: "POST", body: form },
      UPLOAD_TIMEOUT_MS,
    );
    if (!response) return this.networkError(job, "upload");

    if (response.status === 200 || response.status === 201) {
      const body = await this.readJson(response);
      const analysisId = body?.data?.id;
      if (typeof analysisId === "string") {
        this.audit.recordEvent({
          type: "uploaded",
          stage: "upload",
          ...this.jobEvent(job),
          analysisId,
        });
        return { ...job, stage: "analysis", analysisId, attempts: 0 };
      }

      this.audit.recordEvent({
        type: "error",
        stage: "upload",
        ...this.jobEvent(job),
        detail: "Upload response did not include an analysis ID",
      });
      return { ...job, stage: "lookup", attempts: 0 };
    }

    // A concurrent scan or an earlier upload may already have the file.
    if (response.status === 409) {
      const body = await this.readJson(response);
      const analysisId = body?.data?.id;
      if (typeof analysisId === "string") {
        this.audit.recordEvent({
          type: "uploaded",
          stage: "upload",
          ...this.jobEvent(job),
          analysisId,
          detail: "File already known to VirusTotal",
        });
        return { ...job, stage: "analysis", analysisId, attempts: 0 };
      }
      return { ...job, stage: "lookup", attempts: 0 };
    }

    if (response.status === 413) {
      this.audit.recordEvent({
        type: "skipped",
        stage: "upload",
        ...this.jobEvent(job),
        status: response.status,
        detail: "File exceeds the free-tier upload limit",
      });
      this.logger.log(
        `VirusTotal skipped ${job.name}: file exceeds the free-tier upload limit`,
      );
      return undefined;
    }

    return this.handleResponseError(job, response, "upload");
  }

  private async analysisJob(job: ScanJob): Promise<ScanJob | undefined> {
    if (!(await this.waitForRequestSlot())) return job;

    const response = await this.fetchApi(
      `/analyses/${encodeURIComponent(job.analysisId)}`,
      {},
      REQUEST_TIMEOUT_MS,
    );
    if (!response) return this.networkError(job, "analysis");

    if (response.status === 200) {
      const body = await this.readJson(response);
      const attributes = body?.data?.attributes;
      const stats = parseAnalysisStats(attributes);
      const verdict = getScanVerdict(stats);

      if (await this.applyVerdict(job, stats, verdict)) return undefined;

      if (attributes?.status === "completed") {
        this.audit.recordEvent({
          type: "dropped",
          stage: "analysis",
          ...this.jobEvent(job),
          analysisId: job.analysisId,
          detail: "Analysis completed without usable statistics",
        });
        return undefined;
      }

      if (job.attempts >= MAX_ANALYSIS_POLLS) {
        this.audit.recordEvent({
          type: "dropped",
          stage: "analysis",
          ...this.jobEvent(job),
          analysisId: job.analysisId,
          detail: "Analysis polling limit reached",
        });
        this.logger.log(
          `VirusTotal stopped polling ${job.name} before the analysis completed`,
        );
        return undefined;
      }
      return { ...job, attempts: job.attempts + 1 };
    }

    if (response.status === 404) {
      this.audit.recordEvent({
        type: "dropped",
        stage: "analysis",
        ...this.jobEvent(job),
        analysisId: job.analysisId,
        status: response.status,
        detail: "Analysis is no longer available",
      });
      this.logger.debug(
        `VirusTotal analysis ${job.analysisId} for ${job.name} is no longer available`,
      );
      return undefined;
    }

    return this.handleResponseError(job, response, "analysis");
  }

  private async handleResponseError(
    job: ScanJob,
    response: Response,
    stage: ScanStage,
  ): Promise<ScanJob | undefined> {
    if (response.status === 429) {
      const wait = await this.startCooldown(response);
      this.audit.recordEvent({
        type: "rate_limited",
        stage,
        ...this.jobEvent(job),
        status: response.status,
        cooldownSeconds: Math.ceil(wait / 1000),
        detail: `Paused for ${Math.ceil(wait / 60_000)} minute(s)`,
      });
      return job;
    }

    if (response.status === 401 || response.status === 403) {
      this.audit.recordEvent({
        type: "auth_error",
        stage,
        ...this.jobEvent(job),
        status: response.status,
        detail: "VirusTotal rejected the API key",
      });
      this.authFailed = true;
      this.running = false;
      this.logger.error(
        "VirusTotal rejected the API key; scanning is paused until the backend restarts with a valid key",
      );
      return undefined;
    }

    this.audit.recordEvent({
      type: "error",
      stage,
      ...this.jobEvent(job),
      status: response.status,
      detail: `HTTP ${response.status}`,
    });

    if (response.status >= 500)
      return this.retry(job, `HTTP ${response.status}`);

    this.logger.warn(
      `VirusTotal ${stage} request for ${job.name} returned HTTP ${response.status}`,
    );
    return undefined;
  }

  private networkError(job: ScanJob, stage: ScanStage): ScanJob | undefined {
    if (!this.running) return job;
    this.audit.recordEvent({
      type: "error",
      stage,
      ...this.jobEvent(job),
      detail: "Network request failed",
    });
    return this.retry(job, "Network request failed");
  }

  private retry(job: ScanJob, detail?: string): ScanJob | undefined {
    if (job.attempts >= MAX_ATTEMPTS) {
      this.audit.recordEvent({
        type: "dropped",
        stage: job.stage,
        ...this.jobEvent(job),
        detail: detail ?? `Dropped after ${MAX_ATTEMPTS} attempts`,
      });
      this.logger.warn(
        `VirusTotal dropped ${job.name} after ${MAX_ATTEMPTS} failed attempts`,
      );
      return undefined;
    }
    return { ...job, attempts: job.attempts + 1 };
  }

  private async fetchApi(
    path: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response | undefined> {
    const kind: "lookup" | "upload" | "analysis" =
      path === "/files"
        ? "upload"
        : path.startsWith("/analyses/")
          ? "analysis"
          : "lookup";
    this.lastRequestAt = Date.now();
    this.lastRequestKind = kind;
    this.audit.recordApiCall(kind);

    const controller = new AbortController();
    this.currentAbort = controller;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref();

    try {
      return await fetch(`${this.apiBase}${path}`, {
        ...init,
        headers: {
          "x-apikey": this.apiKey,
          ...(init.headers as Record<string, string> | undefined),
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (
        this.running &&
        (!(error instanceof Error) || error.name !== "AbortError")
      )
        this.logger.warn(`VirusTotal request failed: ${errorMessage(error)}`);
      return undefined;
    } finally {
      clearTimeout(timeout);
      if (this.currentAbort === controller) this.currentAbort = undefined;
    }
  }

  private async readJson(
    response: Response,
  ): Promise<VirusTotalResponse | undefined> {
    try {
      return (await response.json()) as VirusTotalResponse;
    } catch {
      return undefined;
    }
  }

  private async readFileBuffer(job: ScanJob): Promise<Buffer> {
    const file = await this.fileService.get(job.shareId, job.fileId);
    if (!file.file) throw new Error("file stream is unavailable");

    this.currentStream = file.file;
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of file.file) {
        const buffer = Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_UPLOAD_BYTES)
          throw new Error("file grew beyond the upload limit");
        chunks.push(buffer);
      }
    } finally {
      file.file.destroy();
      if (this.currentStream === file.file) this.currentStream = undefined;
    }
    return Buffer.concat(chunks);
  }

  private async waitForRequestSlot(): Promise<boolean> {
    while (this.running) {
      const cooldown = await this.cooldownRemaining();
      if (cooldown > 0) {
        await this.sleep(Math.min(cooldown + 250, 60_000));
        continue;
      }

      const gate = await this.valkey.run(async (client) => {
        const acquired = await client.set(REQUEST_LOCK_KEY, this.instanceId, {
          NX: true,
          PX: RATE_LIMIT_MS,
        });
        if (acquired) return { acquired: true, waitMs: 0 };

        const ttl = await client.pTTL(REQUEST_LOCK_KEY);
        return {
          acquired: false,
          waitMs: ttl > 0 ? ttl : RATE_LIMIT_MS,
        };
      });

      // Valkey disabled or unreachable: enforce the same spacing locally.
      if (gate === undefined) {
        const wait =
          Math.max(this.cooldownUntil, this.lastRequestAt + RATE_LIMIT_MS) -
          Date.now();
        if (wait > 0) {
          await this.sleep(Math.min(wait + 250, 60_000));
          continue;
        }
        this.lastRequestAt = Date.now();
        return true;
      }

      if (gate.acquired) {
        this.lastRequestAt = Date.now();
        return true;
      }
      await this.sleep(Math.min(Math.max(gate.waitMs + 250, 1000), 60_000));
    }
    return false;
  }

  private async cooldownRemaining(): Promise<number> {
    const remote = await this.valkey.run((client) => client.pTTL(COOLDOWN_KEY));
    const local = this.cooldownUntil - Date.now();
    return Math.max(
      local,
      typeof remote === "number" && remote > 0 ? remote : 0,
      0,
    );
  }

  private async startCooldown(response: Response) {
    const wait = parseRetryAfterMs(
      response.headers.get("retry-after"),
      RATE_LIMIT_FALLBACK_MS,
      MAX_COOLDOWN_MS,
    );
    this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + wait);
    await this.valkey.run((client) =>
      client.set(COOLDOWN_KEY, "1", { PX: wait }),
    );
    this.logger.warn(
      `VirusTotal rate limit reached; pausing requests for ${Math.ceil(wait / 60_000)} minute(s)`,
    );
    return wait;
  }

  private verdictKey(hash: string) {
    return `${VERDICT_KEY_PREFIX}${hash}`;
  }

  private async getVerdict(hash: string): Promise<ScanVerdict | undefined> {
    const cached = this.memoryVerdicts.get(hash);
    if (cached) {
      if (cached.expiresAt > Date.now()) return cached.verdict;
      this.memoryVerdicts.delete(hash);
    }

    const value = await this.valkey.run((client) =>
      client.get(this.verdictKey(hash)),
    );
    if (value === "clean" || value === "suspicious" || value === "malicious") {
      this.rememberVerdict(hash, value);
      return value;
    }
    return undefined;
  }

  private async setVerdict(hash: string | undefined, verdict: ScanVerdict) {
    if (!hash) return;
    this.rememberVerdict(hash, verdict);
    await this.valkey.run((client) =>
      client.set(this.verdictKey(hash), verdict, {
        EX: VERDICT_TTL_SECONDS,
      }),
    );
  }

  /**
   * Caches a terminal verdict and removes the share for a malicious result.
   * Returns false when VirusTotal has no verdict yet (for example a queued
   * analysis), so the caller can continue polling.
   */
  private async applyVerdict(
    job: ScanJob,
    stats: AnalysisStats | undefined,
    verdict: ScanVerdict | undefined,
  ): Promise<boolean> {
    if (!verdict) return false;

    await this.setVerdict(job.hash, verdict);
    if (verdict === "malicious") {
      const uploader = await this.audit.captureUploader(job.shareId);
      const removed = await this.removeMaliciousShare(job);
      this.audit.recordEvent({
        type: "malicious",
        ...this.jobEvent(job),
        verdict,
        stats,
        removed,
        uploader,
      });
    } else {
      this.audit.recordEvent({
        type: verdict,
        ...this.jobEvent(job),
        verdict,
        stats,
      });
      if (verdict === "suspicious") {
        this.logger.warn(
          `VirusTotal marked ${job.name} as suspicious (${stats?.suspicious ?? 0} engine(s))`,
        );
      }
    }
    return true;
  }

  private rememberVerdict(hash: string, verdict: ScanVerdict) {
    if (this.memoryVerdicts.size >= MAX_MEMORY_VERDICTS) {
      const oldest = this.memoryVerdicts.keys().next().value;
      if (oldest) this.memoryVerdicts.delete(oldest);
    }
    this.memoryVerdicts.set(hash, {
      verdict,
      expiresAt: Date.now() + VERDICT_TTL_SECONDS * 1000,
    });
  }

  private async removeMaliciousShare(job: ScanJob): Promise<boolean> {
    this.logger.warn(
      `VirusTotal flagged ${job.name} in share ${job.shareId}; removing the share files`,
    );
    try {
      await this.clamScanService.removeMaliciousShare(job.shareId, job.name);
      return true;
    } catch (error) {
      this.logger.error(
        `VirusTotal could not remove malicious share ${job.shareId}: ${errorMessage(error)}`,
      );
      return false;
    }
  }

  async getAdminStatus() {
    const queued = await this.valkey.run((client) => client.lLen(QUEUE_KEY));
    const queueBackend = typeof queued === "number" ? "valkey" : "memory";
    const queueDepth =
      (typeof queued === "number" ? queued : 0) + this.memoryQueue.length;
    const cooldown = await this.cooldownRemaining();

    return {
      enabled: !!this.apiKey && !this.authFailed,
      apiKeyConfigured: !!this.apiKey,
      running: this.running,
      authFailed: this.authFailed,
      queueBackend,
      queueDepth,
      pendingJobs: queueDepth + (this.currentJob ? 1 : 0),
      processing: this.currentJob
        ? {
            stage: this.currentJob.stage,
            shareId: this.currentJob.shareId,
            fileId: this.currentJob.fileId,
            fileName: this.currentJob.name,
            size: this.currentJob.size,
            attempts: this.currentJob.attempts,
            startedAt: new Date(this.currentJobStartedAt).toISOString(),
          }
        : undefined,
      cooldownSeconds: Math.ceil(cooldown / 1000),
      rateLimitSeconds: RATE_LIMIT_MS / 1000,
      lastRequestAt: this.lastRequestAt
        ? new Date(this.lastRequestAt).toISOString()
        : undefined,
      lastRequestKind: this.lastRequestKind,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        if (this.wakeTimer) clearTimeout(this.wakeTimer);
        this.wakeTimer = undefined;
        this.wakeResolve = undefined;
        resolve();
      };
      this.wakeResolve = done;
      this.wakeTimer = setTimeout(done, ms);
      this.wakeTimer.unref();
    });
  }

  private wake() {
    this.wakeResolve?.();
  }
}
