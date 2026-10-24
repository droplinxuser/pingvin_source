import { Injectable, Logger } from "@nestjs/common";
import { ValkeyService } from "src/cache/valkey.service";

const QUEUE_KEY = "pingvin:virustotal:queue";
const MAX_QUEUE_JOBS = 1000;

export type ScanStage = "hash" | "lookup" | "upload" | "analysis";

export type ScanJob = {
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

function parseJob(raw: string): ScanJob | undefined {
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

/**
 * Shared VirusTotal job queue. It lives outside the scanner service so file and
 * share deletion paths can remove pending jobs without creating a dependency
 * cycle. Valkey is used when available; the bounded memory list is the same
 * fallback the worker has always used.
 */
@Injectable()
export class VirusTotalQueueService {
  private readonly logger = new Logger(VirusTotalQueueService.name);
  private readonly memoryQueue: ScanJob[] = [];
  private loggedMemoryFallback = false;

  constructor(private readonly valkey: ValkeyService) {}

  async push(job: ScanJob) {
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
      return;
    }

    this.loggedMemoryFallback = false;
    // Keep newest work instead of letting a large backlog occupy Valkey
    // indefinitely. The trim is best-effort; the push already succeeded.
    if (length > MAX_QUEUE_JOBS)
      void this.valkey.run((client) =>
        client.lTrim(QUEUE_KEY, -MAX_QUEUE_JOBS, -1),
      );
  }

  async pop(): Promise<ScanJob | undefined> {
    const local = this.memoryQueue.shift();
    if (local) return local;

    while (true) {
      const raw = await this.valkey.run((client) => client.lPop(QUEUE_KEY));
      if (typeof raw !== "string") return undefined;
      const job = parseJob(raw);
      if (job) return job;
      // Discard malformed entries and continue with the next job.
    }
  }

  async removeForShare(shareId: string) {
    await this.removeMatching((job) => job.shareId === shareId);
  }

  async removeForFile(shareId: string, fileId: string) {
    await this.removeMatching(
      (job) => job.shareId === shareId && job.fileId === fileId,
    );
  }

  async getDepth(): Promise<{
    depth: number;
    backend: "valkey" | "memory";
  }> {
    const queued = await this.valkey.run((client) => client.lLen(QUEUE_KEY));
    return {
      depth:
        (typeof queued === "number" ? queued : 0) + this.memoryQueue.length,
      backend: typeof queued === "number" ? "valkey" : "memory",
    };
  }

  private async removeMatching(predicate: (job: ScanJob) => boolean) {
    for (let index = this.memoryQueue.length - 1; index >= 0; index--) {
      if (predicate(this.memoryQueue[index])) this.memoryQueue.splice(index, 1);
    }

    await this.valkey.run(async (client) => {
      const rawJobs = await client.lRange(QUEUE_KEY, 0, -1);
      const matches = rawJobs.filter((raw) => {
        const job = parseJob(raw);
        return !!job && predicate(job);
      });
      if (matches.length === 0) return;

      const multi = client.multi();
      for (const raw of matches) multi.lRem(QUEUE_KEY, 0, raw);
      await multi.exec();
    });
  }
}
