import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ValkeyService } from "src/cache/valkey.service";

export type ErrorLogSource = "backend" | "frontend";
export type ErrorLogLevel = "error" | "fatal";

export type ErrorLogEntry = {
  id: string;
  at: string;
  source: ErrorLogSource;
  level: ErrorLogLevel;
  message: string;
  stack?: string;
  context?: string;
  url?: string;
  userAgent?: string;
};

export type ErrorLogInput = {
  message: unknown;
  stack?: unknown;
  context?: unknown;
  url?: unknown;
  userAgent?: unknown;
  level?: ErrorLogLevel;
};

export type ErrorLogPage = {
  source: ErrorLogSource;
  entries: ErrorLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  storage: "valkey" | "memory";
};

// Error logs are diagnostic data, so Valkey is the primary store and the
// in-process buffer is only used while Valkey is disabled or unreachable.
// The capped list keeps the cache footprint small; no SQLite writes are made.
const MAX_ENTRIES = 100;
const TTL_SECONDS = 7 * 24 * 60 * 60;
const KEY_PREFIX = "pingvin:errorlogs:";
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_STACK_LENGTH = 12_000;
const MAX_CONTEXT_LENGTH = 200;
const MAX_URL_LENGTH = 1_000;
const MAX_USER_AGENT_LENGTH = 500;
const CLIENT_DEDUPE_MS = 60_000;

@Injectable()
export class ErrorLogService {
  private readonly memory: Record<ErrorLogSource, string[]> = {
    backend: [],
    frontend: [],
  };
  private readonly recentClientErrors = new Map<string, number>();

  constructor(private readonly valkey: ValkeyService) {}

  /** Fire-and-forget capture used by the Nest logger. */
  capture(source: ErrorLogSource, input: ErrorLogInput): void {
    void this.add(source, input).catch(() => {});
  }

  async add(
    source: ErrorLogSource,
    input: ErrorLogInput,
  ): Promise<ErrorLogEntry | undefined> {
    if (source === "frontend" && this.isDuplicateClientError(input))
      return undefined;

    const entry = createEntry(source, input);
    const payload = JSON.stringify(entry);
    const key = `${KEY_PREFIX}${source}`;

    const stored = await this.valkey.run(async (client) => {
      await client
        .multi()
        .lPush(key, payload)
        .lTrim(key, 0, MAX_ENTRIES - 1)
        .expire(key, TTL_SECONDS)
        .exec();
      return true;
    });

    if (!stored) this.remember(source, payload);
    return entry;
  }

  async list(
    source: ErrorLogSource,
    page: number,
    pageSize: number,
  ): Promise<ErrorLogPage> {
    const start = (page - 1) * pageSize;
    const key = `${KEY_PREFIX}${source}`;

    const remote = await this.valkey.run(async (client) => {
      const [items, total] = (await client
        .multi()
        .lRange(key, start, start + pageSize - 1)
        .lLen(key)
        .exec()) as unknown as [string[] | null, number | null];

      return {
        entries: parseEntries(items ?? []),
        total: Number(total ?? 0),
      };
    });

    if (remote)
      return {
        source,
        ...remote,
        page,
        pageSize,
        storage: "valkey",
      };

    const items = this.memory[source];
    return {
      source,
      entries: parseEntries(items.slice(start, start + pageSize)),
      total: items.length,
      page,
      pageSize,
      storage: "memory",
    };
  }

  private remember(source: ErrorLogSource, payload: string) {
    const items = this.memory[source];
    items.unshift(payload);
    if (items.length > MAX_ENTRIES) items.length = MAX_ENTRIES;
  }

  private isDuplicateClientError(input: ErrorLogInput): boolean {
    const now = Date.now();
    if (this.recentClientErrors.size > 200) {
      for (const [key, at] of this.recentClientErrors)
        if (now - at > CLIENT_DEDUPE_MS) this.recentClientErrors.delete(key);
      if (this.recentClientErrors.size > 500) this.recentClientErrors.clear();
    }

    const key = `${text(input.context, 100)}\n${text(input.message, 500)}\n${text(input.stack, 500)}\n${text(input.url, 200)}`;
    const last = this.recentClientErrors.get(key);
    if (last !== undefined && now - last < CLIENT_DEDUPE_MS) return true;

    this.recentClientErrors.set(key, now);
    return false;
  }
}

function createEntry(
  source: ErrorLogSource,
  input: ErrorLogInput,
): ErrorLogEntry {
  const entry: ErrorLogEntry = {
    id: randomUUID(),
    at: new Date().toISOString(),
    source,
    level: input.level === "fatal" ? "fatal" : "error",
    message: text(input.message, MAX_MESSAGE_LENGTH) ?? "Unknown error",
  };

  const stack = text(input.stack, MAX_STACK_LENGTH);
  const context = text(input.context, MAX_CONTEXT_LENGTH);
  const url = text(input.url, MAX_URL_LENGTH);
  const userAgent = text(input.userAgent, MAX_USER_AGENT_LENGTH);

  if (stack) entry.stack = stack;
  if (context) entry.context = context;
  if (url) entry.url = url;
  if (userAgent) entry.userAgent = userAgent;

  return entry;
}

function text(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;

  let result: string;
  if (value instanceof Error) result = value.message;
  else if (typeof value === "string") result = value;
  else {
    try {
      result = JSON.stringify(value);
    } catch {
      result = String(value);
    }
  }

  if (!result) return undefined;
  // Strip terminal control sequences from client-supplied text; keeping only
  // newline and tab prevents ANSI escapes from reaching copied logs.
  // eslint-disable-next-line no-control-regex
  result = result.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "");
  return result.length > maxLength ? `${result.slice(0, maxLength)}…` : result;
}

function parseEntries(items: string[]): ErrorLogEntry[] {
  const entries: ErrorLogEntry[] = [];
  for (const item of items) {
    try {
      const entry = JSON.parse(item) as ErrorLogEntry;
      if (entry && typeof entry.id === "string" && entry.message)
        entries.push(entry);
    } catch {
      // Ignore a truncated or corrupted list item.
    }
  }
  return entries;
}
