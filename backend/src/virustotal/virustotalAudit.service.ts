import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from "@nestjs/common";
import * as crypto from "crypto";
import { promises as fs } from "fs";
import { join } from "path";
import { PrismaService } from "src/prisma/prisma.service";
import { readUploaderInfo } from "src/utils/uploaderInfo.util";
import { DATA_DIRECTORY } from "../constants";
import { AnalysisStats, ScanVerdict } from "./virustotal.util";

const STATE_DIRECTORY = join(DATA_DIRECTORY, "virustotal");
const STATE_FILE = join(STATE_DIRECTORY, "state.json");
const STATE_VERSION = 1;
const MAX_EVENTS = 200;
const CALL_RETENTION_MS = 48 * 60 * 60 * 1000;
const DAILY_RETENTION_DAYS = 30;
const WRITE_DEBOUNCE_MS = 1000;
const WRITE_ERROR_LOG_INTERVAL_MS = 30 * 1000;

export type VirusTotalEventType =
  | "queued"
  | "uploaded"
  | "clean"
  | "suspicious"
  | "malicious"
  | "error"
  | "rate_limited"
  | "auth_error"
  | "skipped"
  | "dropped";

type ApiCallKind = "lookup" | "upload" | "analysis";

export type VirusTotalUploader = {
  anonymous: boolean;
  creator?: {
    id: string;
    username: string;
    displayName?: string;
    email: string;
  };
  reverseShareCreator?: {
    id: string;
    username: string;
    displayName?: string;
    email: string;
  };
  country?: string;
  city?: string;
  browser?: string;
  os?: string;
  deviceType?: string;
  uploadedAt?: string;
};

export type VirusTotalEvent = {
  id: string;
  at: string;
  type: VirusTotalEventType;
  shareId: string;
  fileId?: string;
  fileName?: string;
  size?: number;
  hash?: string;
  verdict?: ScanVerdict;
  stats?: AnalysisStats;
  status?: number;
  stage?: string;
  detail?: string;
  analysisId?: string;
  cached?: boolean;
  removed?: boolean;
  cooldownSeconds?: number;
  uploader?: VirusTotalUploader;
};

type VirusTotalEventInput = Omit<VirusTotalEvent, "id" | "at">;

type ApiCall = {
  at: number;
  kind: ApiCallKind;
};

type DailyCounters = Record<string, number>;

type AuditState = {
  version: number;
  updatedAt: string;
  events: VirusTotalEvent[];
  calls: ApiCall[];
  daily: Record<string, DailyCounters>;
};

export type VirusTotalAuditStats = {
  calls: {
    lastHour: number;
    today: number;
    last24Hours: number;
    byKindLast24Hours: Record<ApiCallKind, number>;
  };
  scans: {
    queued: number;
    uploaded: number;
    clean: number;
    suspicious: number;
    malicious: number;
    removed: number;
    errors: number;
    rateLimited: number;
    authErrors: number;
    skipped: number;
    dropped: number;
  };
};

export type VirusTotalAuditOverview = {
  stats: VirusTotalAuditStats;
  events: VirusTotalEvent[];
  eventsTotal: number;
  updatedAt: string;
  storage: string;
  timezone: string;
  todayStart: string;
};

function emptyState(): AuditState {
  return {
    version: STATE_VERSION,
    updatedAt: new Date(0).toISOString(),
    events: [],
    calls: [],
    daily: {},
  };
}

function localDateKey(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDayStart(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Bounded, file-backed operational history for the VirusTotal worker. It is
 * deliberately not stored in SQLite: one JSON state file under the data
 * directory holds recent events, API-call timestamps and daily counters.
 */
@Injectable()
export class VirusTotalAuditService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(VirusTotalAuditService.name);
  private state = emptyState();
  private dirty = false;
  private writeTimer?: NodeJS.Timeout;
  private writePromise: Promise<void> = Promise.resolve();
  private lastWriteErrorLog = 0;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.load();
    // Make the file-backed store visible to administrators before the first
    // scan event, without overwriting an existing or corrupt file.
    try {
      await fs.access(STATE_FILE);
    } catch {
      this.state.updatedAt = new Date().toISOString();
      this.dirty = true;
      await this.flush();
    }
  }

  onApplicationShutdown() {
    return this.flush();
  }

  recordEvent(input: VirusTotalEventInput) {
    const now = Date.now();
    const at = new Date(now).toISOString();
    this.state.events.unshift({
      id: crypto.randomUUID(),
      at,
      ...input,
    });
    if (this.state.events.length > MAX_EVENTS)
      this.state.events.length = MAX_EVENTS;

    const day = localDateKey(now);
    const counters = (this.state.daily[day] ??= {});
    counters[input.type] = (counters[input.type] ?? 0) + 1;
    if (input.type === "malicious" && input.removed)
      counters.removed = (counters.removed ?? 0) + 1;

    this.state.updatedAt = at;
    this.prune(now);
    this.scheduleWrite();
  }

  recordApiCall(kind: ApiCallKind) {
    const now = Date.now();
    this.state.calls.push({ at: now, kind });
    this.state.updatedAt = new Date(now).toISOString();
    this.prune(now);
    this.scheduleWrite();
  }

  getOverview(limit = 100): VirusTotalAuditOverview {
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const todayStart = localDayStart(now);

    let lastHour = 0;
    let today = 0;
    let last24Hours = 0;
    const byKindLast24Hours: Record<ApiCallKind, number> = {
      lookup: 0,
      upload: 0,
      analysis: 0,
    };

    for (const call of this.state.calls) {
      if (call.at < dayAgo) continue;
      last24Hours++;
      byKindLast24Hours[call.kind]++;
      if (call.at >= todayStart) today++;
      if (call.at >= hourAgo) lastHour++;
    }

    const counters = this.state.daily[localDateKey(now)] ?? {};
    const count = (key: string) => counters[key] ?? 0;

    return {
      stats: {
        calls: {
          lastHour,
          today,
          last24Hours,
          byKindLast24Hours,
        },
        scans: {
          queued: count("queued"),
          uploaded: count("uploaded"),
          clean: count("clean"),
          suspicious: count("suspicious"),
          malicious: count("malicious"),
          removed: count("removed"),
          errors: count("error"),
          rateLimited: count("rate_limited"),
          authErrors: count("auth_error"),
          skipped: count("skipped"),
          dropped: count("dropped"),
        },
      },
      events: this.state.events.slice(0, limit),
      eventsTotal: this.state.events.length,
      updatedAt: this.state.updatedAt,
      storage: "virustotal/state.json",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      todayStart: new Date(todayStart).toISOString(),
    };
  }

  /**
   * Captures who uploaded the share before a malicious share is deleted.
   * Registered creators and reverse-share owners are both kept, plus the
   * Cloudflare-derived uploader metadata already stored with the share.
   */
  async captureUploader(
    shareId: string,
  ): Promise<VirusTotalUploader | undefined> {
    try {
      const [share, info] = await Promise.all([
        this.prisma.share.findUnique({
          where: { id: shareId },
          select: {
            creator: {
              select: {
                id: true,
                username: true,
                displayName: true,
                email: true,
              },
            },
            reverseShare: {
              select: {
                creator: {
                  select: {
                    id: true,
                    username: true,
                    displayName: true,
                    email: true,
                  },
                },
              },
            },
            createdAt: true,
          },
        }),
        readUploaderInfo(shareId).catch(() => null),
      ]);

      if (!share?.creator && !share?.reverseShare?.creator && !info)
        return undefined;

      return {
        anonymous: !share?.creator,
        creator: share?.creator
          ? {
              id: share.creator.id,
              username: share.creator.username,
              displayName: share.creator.displayName || undefined,
              email: share.creator.email,
            }
          : undefined,
        reverseShareCreator: share?.reverseShare?.creator
          ? {
              id: share.reverseShare.creator.id,
              username: share.reverseShare.creator.username,
              displayName: share.reverseShare.creator.displayName || undefined,
              email: share.reverseShare.creator.email,
            }
          : undefined,
        country: info?.country,
        city: info?.city,
        browser: info?.browser,
        os: info?.os,
        deviceType: info?.deviceType,
        uploadedAt: info?.createdAt ?? share?.createdAt?.toISOString(),
      };
    } catch (error) {
      this.logger.debug(
        `Could not capture uploader context for share ${shareId}: ${error}`,
      );
      return undefined;
    }
  }

  async flush() {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = undefined;
    }
    if (!this.dirty) return this.writePromise;

    this.dirty = false;
    const payload = JSON.stringify(this.state, null, 2);
    this.writePromise = this.writePromise
      .then(async () => {
        await fs.mkdir(STATE_DIRECTORY, { recursive: true, mode: 0o700 });
        const tempFile = `${STATE_FILE}.${process.pid}.${crypto
          .randomUUID()
          .slice(0, 8)}.tmp`;
        try {
          await fs.writeFile(tempFile, payload, {
            encoding: "utf8",
            mode: 0o600,
          });
          await fs.rename(tempFile, STATE_FILE);
        } catch (error) {
          await fs.rm(tempFile, { force: true }).catch(() => {});
          throw error;
        }
      })
      .catch((error) => {
        this.dirty = true;
        if (
          Date.now() - this.lastWriteErrorLog >=
          WRITE_ERROR_LOG_INTERVAL_MS
        ) {
          this.lastWriteErrorLog = Date.now();
          this.logger.warn(
            `Could not write VirusTotal audit state: ${error instanceof Error ? error.message : error}`,
          );
        }
      });

    return this.writePromise;
  }

  private async load() {
    try {
      const raw = await fs.readFile(STATE_FILE, "utf8");
      const parsed = JSON.parse(raw) as Partial<AuditState>;
      if (
        !parsed ||
        parsed.version !== STATE_VERSION ||
        !Array.isArray(parsed.events) ||
        !Array.isArray(parsed.calls) ||
        !parsed.daily ||
        typeof parsed.daily !== "object"
      ) {
        this.logger.warn(
          "VirusTotal audit state has an unsupported format; starting fresh",
        );
        this.state = emptyState();
        return;
      }
      this.state = {
        version: STATE_VERSION,
        updatedAt:
          typeof parsed.updatedAt === "string"
            ? parsed.updatedAt
            : new Date(0).toISOString(),
        events: parsed.events.slice(0, MAX_EVENTS) as VirusTotalEvent[],
        calls: (parsed.calls as ApiCall[])
          .filter(
            (call) =>
              call &&
              Number.isFinite(call.at) &&
              ["lookup", "upload", "analysis"].includes(call.kind),
          )
          .sort((a, b) => a.at - b.at),
        daily: parsed.daily as Record<string, DailyCounters>,
      };
      this.prune(Date.now());
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        this.logger.warn(
          `Could not read VirusTotal audit state: ${error instanceof Error ? error.message : error}`,
        );
      }
      this.state = emptyState();
    }
  }

  private prune(now: number) {
    const callsCutoff = now - CALL_RETENTION_MS;
    this.state.calls = this.state.calls.filter(
      (call) => call.at >= callsCutoff,
    );

    const dailyCutoff = localDateKey(
      now - DAILY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    for (const day of Object.keys(this.state.daily)) {
      if (day < dailyCutoff) delete this.state.daily[day];
    }
  }

  private scheduleWrite() {
    this.dirty = true;
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined;
      void this.flush();
    }, WRITE_DEBOUNCE_MS);
    this.writeTimer.unref();
  }
}
