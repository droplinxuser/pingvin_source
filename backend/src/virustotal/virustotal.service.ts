import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from "@nestjs/common";
import * as crypto from "crypto";
import * as FormDataNode from "form-data";
import * as http from "http";
import * as https from "https";
import { Readable } from "stream";
import { ValkeyService } from "src/cache/valkey.service";
import { ClamScanService } from "src/clamscan/clamscan.service";
import { EmailService } from "src/email/email.service";
import { FileService } from "src/file/file.service";
import {
  VirusTotalAuditService,
  VirusTotalUploader,
} from "./virustotalAudit.service";
import {
  ScanJob,
  ScanStage,
  VirusTotalQueueService,
} from "./virustotalQueue.service";
import {
  AnalysisStats,
  ScanVerdict,
  getScanVerdict,
  parseAnalysisStats,
  parseRetryAfterMs,
  sha256Stream,
  shouldScanFile,
} from "./virustotal.util";
import {
  isArchiveFileName,
  isEncryptedArchive as detectEncryptedArchive,
} from "./archiveEncryption.util";

const API_BASE_DEFAULT = "https://www.virustotal.com/api/v3";
// 499 intervals at 173s fit in 24h, allowing exactly 500 starts/day.
const RATE_LIMIT_MS = 173 * 1000;
const REQUEST_TIMEOUT_MS = 30 * 1000;
const UPLOAD_TIMEOUT_MS = 2 * 60 * 1000;
const LARGE_UPLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_STANDARD_UPLOAD_BYTES = 32 * 1024 * 1024;
// The site caps individual files at 512 MB; VirusTotal accepts large uploads
// through /files/upload_url up to 650 MB.
const MAX_LARGE_UPLOAD_BYTES = 512 * 1024 * 1024;
const MAX_ATTEMPTS = 3;
const MAX_ANALYSIS_POLLS = 20;
const IDLE_MS = 5 * 1000;
const MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_FALLBACK_MS = 15 * 60 * 1000;
const VERDICT_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_MEMORY_VERDICTS = 1000;
// Archive encryption detection only reads headers and central directories;
// this cap protects against a malformed archive that claims a huge range.
const MAX_ARCHIVE_RANGE_BYTES = 8 * 1024 * 1024;

const REQUEST_LOCK_KEY = "pingvin:virustotal:request";
const COOLDOWN_KEY = "pingvin:virustotal:cooldown";
const VERDICT_KEY_PREFIX = "pingvin:virustotal:verdict:";

type VirusTotalResponse = {
  data?: {
    id?: string;
    attributes?: Record<string, unknown>;
  };
};

type VirusTotalUploadUrlResponse = {
  data?: string;
};

type UploadResult =
  | { kind: "response"; response: Response }
  | { kind: "network" }
  | { kind: "drop"; detail: string }
  | { kind: "retry"; detail: string };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "unknown error";
}

export type VirusTotalShare = {
  id: string;
  files: { id: string; name: string; size: string }[];
};

/**
 * Best-effort VirusTotal scanning for completed shares.
 *
 * Every step is queued and executed by one background loop. A Valkey lock
 * spaces API calls 173 seconds apart across restarts and instances; the
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
  private readonly memoryVerdicts = new Map<
    string,
    { verdict: ScanVerdict; expiresAt: number }
  >();

  private running = false;
  private authFailed = false;
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
    private readonly queue: VirusTotalQueueService,
    private readonly email: EmailService,
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
      "VirusTotal scanning is enabled (one API request per 173 seconds)",
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

      const size = Number(file.size) || 0;
      if (await this.isEncryptedArchive(shareId, file.id, file.name, size)) {
        this.audit.recordEvent({
          type: "skipped",
          stage: "hash",
          shareId,
          fileId: file.id,
          fileName: file.name,
          size,
          detail:
            "Password-protected archive (VirusTotal cannot inspect its contents)",
        });
        continue;
      }

      await this.pushJob({
        stage: "hash",
        shareId,
        fileId: file.id,
        name: file.name,
        size,
        attempts: 0,
      });
      this.audit.recordEvent({
        type: "queued",
        shareId,
        fileId: file.id,
        fileName: file.name,
        size,
      });
    }
  }

  private async isEncryptedArchive(
    shareId: string,
    fileId: string,
    fileName: string,
    size: number,
  ): Promise<boolean> {
    if (!isArchiveFileName(fileName) || size <= 0) return false;
    return detectEncryptedArchive(fileName, size, (start, end) =>
      this.readArchiveRange(shareId, fileId, start, end),
    );
  }

  private async readArchiveRange(
    shareId: string,
    fileId: string,
    start: number,
    end: number,
  ): Promise<Buffer | undefined> {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start
    )
      return undefined;

    let file: Awaited<ReturnType<FileService["get"]>>;
    try {
      file = await this.fileService.get(shareId, fileId, { start, end });
    } catch {
      return undefined;
    }
    if (!file.file) return undefined;

    const chunks: Buffer[] = [];
    let length = 0;
    try {
      for await (const chunk of file.file) {
        const buffer = Buffer.from(chunk);
        length += buffer.length;
        if (length > MAX_ARCHIVE_RANGE_BYTES)
          throw new Error("archive detection range is too large");
        chunks.push(buffer);
      }
    } catch {
      return undefined;
    } finally {
      file.file.destroy();
    }

    return Buffer.concat(chunks);
  }

  private async pushJob(job: ScanJob) {
    await this.queue.push(job);
  }

  private async nextJob(): Promise<ScanJob | undefined> {
    return this.queue.pop();
  }

  async removeJobsForShare(shareIds: string | string[]) {
    const ids = Array.isArray(shareIds) ? shareIds : [shareIds];
    await Promise.all(ids.map((shareId) => this.queue.removeForShare(shareId)));
  }

  async removeJobsForFile(shareId: string, fileId: string) {
    await this.queue.removeForFile(shareId, fileId);
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

  private async ensureJobExists(job: ScanJob, stage: ScanStage) {
    if (await this.fileService.exists(job.shareId, job.fileId)) return true;

    this.audit.recordEvent({
      type: "dropped",
      stage,
      ...this.jobEvent(job),
      detail: "File or share was deleted before the scan completed",
    });
    return false;
  }

  private async hashJob(job: ScanJob): Promise<ScanJob | undefined> {
    // File and share rows are removed together by the retention jobs and the
    // owner/admin delete endpoints. Drop any job that survived that deletion
    // instead of spending an API call on it. The other stages check after
    // waiting for their rate-limit slot.
    if (!(await this.ensureJobExists(job, "hash"))) return undefined;

    let stream: Readable | undefined;
    try {
      const file = await this.fileService.get(job.shareId, job.fileId);
      stream = file.file;
      if (!stream) return undefined;
      this.currentStream = stream;

      const hash = await sha256Stream(stream);
      const hashedJob = { ...job, hash };

      // A permanent malicious-hash ledger under the data directory catches
      // re-uploads without spending an API call, even after the Valkey verdict
      // cache has expired or the backend has restarted.
      if (await this.audit.isKnownMaliciousHash(hash)) {
        await this.handleMalicious(hashedJob, { cached: true });
        return undefined;
      }

      const cached = await this.getVerdict(hash);
      if (cached === "malicious") {
        await this.handleMalicious(hashedJob, { cached: true });
        return undefined;
      }
      if (cached) {
        this.audit.recordEvent({
          type: cached,
          ...this.jobEvent(hashedJob),
          verdict: cached,
          cached: true,
        });
        return undefined;
      }

      return { ...hashedJob, stage: "lookup", attempts: 0 };
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
    if (!(await this.ensureJobExists(job, "lookup"))) return undefined;

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
    if (job.size > MAX_LARGE_UPLOAD_BYTES) {
      this.audit.recordEvent({
        type: "skipped",
        stage: "upload",
        ...this.jobEvent(job),
        detail: "File exceeds the VirusTotal upload limit",
      });
      this.logger.log(
        `VirusTotal skipped ${job.name}: file exceeds the VirusTotal upload limit`,
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
    if (job.size > MAX_LARGE_UPLOAD_BYTES) {
      this.audit.recordEvent({
        type: "skipped",
        stage: "upload",
        ...this.jobEvent(job),
        detail: "File exceeds the VirusTotal upload limit",
      });
      return undefined;
    }
    if (!(await this.waitForRequestSlot())) return job;
    if (!(await this.ensureJobExists(job, "upload"))) return undefined;

    const result = await this.sendUpload(job);
    if (result.kind === "network") return this.networkError(job, "upload");
    if (result.kind === "retry") {
      this.audit.recordEvent({
        type: "error",
        stage: "upload",
        ...this.jobEvent(job),
        detail: result.detail,
      });
      return this.retry(job, result.detail);
    }
    if (result.kind === "drop") {
      this.audit.recordEvent({
        type: "error",
        stage: "upload",
        ...this.jobEvent(job),
        detail: result.detail,
      });
      this.logger.warn(
        `VirusTotal could not read ${job.name}: ${result.detail}`,
      );
      return undefined;
    }

    const response = result.response;
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
        detail: "File exceeds the VirusTotal upload limit",
      });
      this.logger.log(
        `VirusTotal skipped ${job.name}: file exceeds the VirusTotal upload limit`,
      );
      return undefined;
    }

    return this.handleResponseError(job, response, "upload");
  }

  /**
   * Small files use POST /files directly. Files above 32 MB first request a
   * one-time upload URL and are streamed to it, so a 512 MB scan never has to
   * sit in process memory.
   */
  private async sendUpload(job: ScanJob): Promise<UploadResult> {
    if (job.size <= MAX_STANDARD_UPLOAD_BYTES) {
      let buffer: Buffer;
      try {
        buffer = await this.readFileBuffer(job);
      } catch (error) {
        return { kind: "drop", detail: errorMessage(error) };
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
      return response ? { kind: "response", response } : { kind: "network" };
    }

    const urlResponse = await this.fetchApi(
      "/files/upload_url",
      {},
      REQUEST_TIMEOUT_MS,
      "upload",
    );
    if (!urlResponse) return { kind: "network" };
    if (urlResponse.status !== 200)
      return { kind: "response", response: urlResponse };

    const body = (await this.readJson(urlResponse)) as
      | VirusTotalUploadUrlResponse
      | undefined;
    if (typeof body?.data !== "string")
      return {
        kind: "retry",
        detail: "Upload URL response did not include a URL",
      };

    return this.sendLargeUpload(job, body.data);
  }

  private async sendLargeUpload(
    job: ScanJob,
    uploadUrl: string,
  ): Promise<UploadResult> {
    let file: Awaited<ReturnType<FileService["get"]>>;
    try {
      file = await this.fileService.get(job.shareId, job.fileId);
    } catch (error) {
      return { kind: "drop", detail: errorMessage(error) };
    }
    if (!file.file)
      return { kind: "drop", detail: "file stream is unavailable" };

    this.currentStream = file.file;
    const form = new FormDataNode();
    form.append("file", file.file, {
      filename: job.name || job.fileId,
      knownLength: job.size,
      contentType: "application/octet-stream",
    });

    const controller = new AbortController();
    this.currentAbort = controller;
    const timeout = setTimeout(
      () => controller.abort(),
      LARGE_UPLOAD_TIMEOUT_MS,
    );
    timeout.unref();
    this.lastRequestAt = Date.now();
    this.lastRequestKind = "upload";
    this.audit.recordApiCall("upload");

    try {
      const headers = form.getHeaders();
      headers["x-apikey"] = this.apiKey;
      if (form.hasKnownLength())
        headers["Content-Length"] = form.getLengthSync();

      const response = await this.postLargeUpload(
        uploadUrl,
        form,
        headers,
        controller.signal,
      );
      return { kind: "response", response };
    } catch (error) {
      if (
        this.running &&
        (!(error instanceof Error) || error.name !== "AbortError")
      )
        this.logger.warn(
          `VirusTotal large upload failed: ${errorMessage(error)}`,
        );
      return { kind: "network" };
    } finally {
      clearTimeout(timeout);
      if (this.currentAbort === controller) this.currentAbort = undefined;
      form.destroy();
      file.file.destroy();
      if (this.currentStream === file.file) this.currentStream = undefined;
    }
  }

  /**
   * Streams the multipart form with node:http instead of undici. This keeps
   * the 512 MB upload out of process memory and lets the request honor the
   * same AbortController as the rest of the scanner.
   */
  private postLargeUpload(
    uploadUrl: string,
    form: FormDataNode,
    headers: FormDataNode.Headers,
    signal: AbortSignal,
  ): Promise<Response> {
    return new Promise((resolve, reject) => {
      const target = new URL(uploadUrl);
      const transport = target.protocol === "https:" ? https : http;
      const request = transport.request(
        target,
        { method: "POST", headers, signal },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          response.on("end", () => {
            const responseHeaders = new Headers();
            for (const [key, value] of Object.entries(response.headers)) {
              if (value === undefined) continue;
              responseHeaders.set(
                key,
                Array.isArray(value) ? value.join(", ") : value,
              );
            }
            resolve(
              new Response(Buffer.concat(chunks), {
                status: response.statusCode ?? 500,
                statusText: response.statusMessage,
                headers: responseHeaders,
              }),
            );
          });
          response.on("error", reject);
        },
      );
      request.on("error", reject);
      form.on("error", reject);
      form.pipe(request);
    });
  }

  private async analysisJob(job: ScanJob): Promise<ScanJob | undefined> {
    if (!(await this.waitForRequestSlot())) return job;
    if (!(await this.ensureJobExists(job, "analysis"))) return undefined;

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

    // 401 is a bad or inactive API key. A 403 (ForbiddenError) means the key
    // is valid but lacks permission for this operation, so it must not pause
    // scanning for every other file.
    if (response.status === 401) {
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
    kindOverride?: "lookup" | "upload" | "analysis",
  ): Promise<Response | undefined> {
    const kind: "lookup" | "upload" | "analysis" =
      kindOverride ??
      (path === "/files"
        ? "upload"
        : path.startsWith("/analyses/")
          ? "analysis"
          : "lookup");
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
        if (size > MAX_STANDARD_UPLOAD_BYTES)
          throw new Error("file grew beyond the standard upload limit");
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
   * Caches a terminal verdict and removes only the offending file for a
   * malicious result. Returns false when VirusTotal has no verdict yet (for
   * example a queued analysis), so the caller can continue polling.
   */
  private async applyVerdict(
    job: ScanJob,
    stats: AnalysisStats | undefined,
    verdict: ScanVerdict | undefined,
  ): Promise<boolean> {
    if (!verdict) return false;

    await this.setVerdict(job.hash, verdict);
    if (verdict === "malicious") {
      await this.handleMalicious(job, { stats });
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

  private async handleMalicious(
    job: ScanJob,
    extra: { stats?: AnalysisStats; cached?: boolean } = {},
  ) {
    const uploader = await this.audit.captureUploader(job.shareId);
    const remainingFiles = await this.removeMaliciousFile(job);

    if (job.hash) await this.audit.rememberMaliciousHash(job.hash);

    this.audit.recordEvent({
      type: "malicious",
      ...this.jobEvent(job),
      verdict: "malicious",
      ...extra,
      removed: remainingFiles !== undefined,
      detail: this.removalDetail(remainingFiles),
      uploader,
    });

    if (remainingFiles !== undefined)
      await this.notifyMalwareRemoval(job, uploader, remainingFiles);
  }

  private async notifyMalwareRemoval(
    job: ScanJob,
    uploader: VirusTotalUploader | undefined,
    remainingFiles: number,
  ) {
    // Registered creators are the uploader. For an anonymous reverse-share
    // upload there is no uploader account, so notify the reverse-share owner.
    const recipient = uploader?.creator ?? uploader?.reverseShareCreator;
    if (!recipient?.email) return;

    try {
      await this.email.sendMalwareRemovalEmail(
        recipient.email,
        job.shareId,
        job.name,
        remainingFiles,
        recipient.displayName || recipient.username,
      );
    } catch (error) {
      this.logger.warn(
        `Could not send VirusTotal removal notice for share ${job.shareId}: ${errorMessage(error)}`,
      );
    }
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

  private async removeMaliciousFile(job: ScanJob): Promise<number | undefined> {
    this.logger.warn(
      `VirusTotal flagged ${job.name} in share ${job.shareId}; removing only the offending file`,
    );
    try {
      const remainingFiles = await this.clamScanService.removeMaliciousFile(
        job.shareId,
        job.fileId,
        job.name,
        `Your share got removed because VirusTotal flagged the file(s) ${job.name} as malicious.`,
      );
      this.logger.warn(
        `VirusTotal removed ${job.name} from share ${job.shareId}; ${remainingFiles} file(s) remain`,
      );
      return remainingFiles;
    } catch (error) {
      this.logger.error(
        `VirusTotal could not remove malicious file ${job.fileId} from share ${job.shareId}: ${errorMessage(error)}`,
      );
      return undefined;
    }
  }

  private removalDetail(remainingFiles: number | undefined): string {
    if (remainingFiles === undefined) return "Failed to remove offending file";
    if (remainingFiles === 0) return "Offending file removed; no files remain";
    return `Offending file removed; ${remainingFiles} clean file${remainingFiles === 1 ? "" : "s"} retained`;
  }

  async getAdminStatus() {
    const queue = await this.queue.getDepth();
    const cooldown = await this.cooldownRemaining();

    return {
      enabled: !!this.apiKey && !this.authFailed,
      apiKeyConfigured: !!this.apiKey,
      running: this.running,
      authFailed: this.authFailed,
      queueBackend: queue.backend,
      queueDepth: queue.depth,
      pendingJobs: queue.depth + (this.currentJob ? 1 : 0),
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
