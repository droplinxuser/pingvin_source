import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { publicShareWhere, sumFileSizes } from "src/share/share.util";
import { findPreview } from "src/share/preview.util";
import { TrendingShare } from "./trending.service";
import { ValkeyService } from "./valkey.service";

// The public-content search index lives entirely in Valkey (with an in-process
// copy). SQLite only provides the rows used to build the index; no search table
// or FTS structure is created. Results themselves are edge-cached, so the
// endpoint costs at most one index read per cache window.
const INDEX_KEY = "pingvin:search:index";
const INDEX_TTL_SECONDS = 5 * 60;
// Serve the in-process copy for a minute before re-reading Valkey. Long enough
// to collapse a burst, short enough that an edit shows up quickly.
const INDEX_FRESH_MS = 60 * 1000;
const INDEX_CACHE_VERSION = 4;
const MAX_CARD_FILE_NAMES = 3;
const MAX_INDEXED_SHARES = 20_000;
const MAX_RESULTS = 200;
const MAX_QUERY_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 240;
const MAX_NAME_LENGTH = 200;

type SearchEntry = {
  id: string;
  n?: string;
  d?: string;
  v: number;
  p?: { id: string; k: "image" | "video"; video?: boolean };
  fn?: string[];
  fc: number;
  s: number;
  c: string;
  u: string;
};

// `items` is the serialized payload; `haystacks` is derived once per load and
// kept only in process memory. Storing the lowercase search text in Valkey
// duplicated the name and description for every entry, so it is rebuilt on
// read instead of paying that footprint in the cache.
type Indexed = { at: number; items: SearchEntry[]; haystacks: string[] };

/**
 * Searches the text of every public share. The index is stored in Valkey as a
 * single JSON value guarded by a version/timestamp envelope, and rebuilt from
 * SQLite when it is missing or stale.
 */
@Injectable()
export class SearchService {
  private index?: Indexed;
  private pending?: Promise<Indexed>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly valkey: ValkeyService,
  ) {}

  async search(query: string, limit = 24): Promise<TrendingShare[]> {
    const term = query.trim().toLowerCase().slice(0, MAX_QUERY_LENGTH);
    if (!term) return [];

    const tokens = term.split(/\s+/).filter(Boolean);
    const { items, haystacks } = await this.getIndex();

    const max = Math.min(Math.max(limit, 1), MAX_RESULTS);
    const matches = items.filter((_, index) =>
      tokens.every((token) => haystacks[index].includes(token)),
    );

    matches.sort(
      (a, b) => score(b, term) - score(a, term) || b.c.localeCompare(a.c),
    );

    return matches.slice(0, max).map(toTrendingShare);
  }

  /**
   * Marks the index stale after a share is created, edited, removed or expires.
   * The next search rebuilds it from SQLite once and repopulates Valkey.
   */
  async invalidate(): Promise<void> {
    this.index = undefined;
    await this.valkey.run((client) => client.del(INDEX_KEY));
  }

  private async getIndex(): Promise<Indexed> {
    if (this.index && Date.now() - this.index.at < INDEX_FRESH_MS)
      return this.index;

    if (!this.pending)
      this.pending = this.loadIndex().finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }

  private async loadIndex(): Promise<Indexed> {
    const cached = await this.valkey.run((client) => client.get(INDEX_KEY));
    if (cached) {
      const parsed = parseIndex(cached);
      if (parsed) {
        const index = indexFrom(parsed);
        this.index = index;
        return index;
      }
    }

    const shares = await this.prisma.share
      .findMany({
        where: publicShareWhere(),
        select: {
          id: true,
          name: true,
          description: true,
          createdAt: true,
          updatedAt: true,
          views: true,
          files: {
            select: { id: true, name: true, size: true },
            orderBy: { name: "asc" },
          },
        },
        orderBy: { createdAt: "desc" },
        take: MAX_INDEXED_SHARES,
      })
      .catch(() => undefined);

    // A failed read must not replace a usable index with an empty one.
    if (!shares) return this.index ?? indexFrom([]);

    const items = shares.map(buildEntry);
    const index = indexFrom(items);
    this.index = index;
    await this.valkey.run((client) =>
      client.set(
        INDEX_KEY,
        JSON.stringify({ v: INDEX_CACHE_VERSION, items }),
        { EX: INDEX_TTL_SECONDS },
      ),
    );
    return index;
  }
}

/** Derives the per-entry lowercase search text once per index load. */
function indexFrom(items: SearchEntry[]): Indexed {
  return {
    at: Date.now(),
    items,
    haystacks: items.map(
      (entry) =>
        `${entry.n ?? ""}\n${entry.d ?? ""}\n${entry.id}`.toLowerCase(),
    ),
  };
}

function buildEntry(share: {
  id: string;
  name?: string | null;
  description?: string | null;
  createdAt: Date | string;
  updatedAt?: Date | string | null;
  views: number;
  files?: { id: string; name: string; size: string | number }[];
}): SearchEntry {
  const name = share.name?.slice(0, MAX_NAME_LENGTH);
  const description = share.description
    ?.replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DESCRIPTION_LENGTH);
  const media = findPreview(share.files);

  return {
    id: share.id,
    n: name || undefined,
    d: description || undefined,
    v: share.views,
    p: media
      ? {
          id: media.preview.id,
          k: media.preview.kind,
          video: media.hasVideo || undefined,
        }
      : undefined,
    fn: share.files?.slice(0, MAX_CARD_FILE_NAMES).map((file) => file.name),
    fc: share.files?.length ?? 0,
    s: sumFileSizes(share.files),
    c: new Date(share.createdAt).toISOString(),
    u: new Date(share.updatedAt ?? share.createdAt).toISOString(),
  };
}

function score(entry: SearchEntry, term: string): number {
  const name = entry.n?.toLowerCase() ?? "";
  if (name === term) return 5;
  if (name.startsWith(term)) return 4;
  if (name.includes(term)) return 3;
  if (entry.d?.toLowerCase().includes(term)) return 2;
  return 1;
}

function parseIndex(raw: string): SearchEntry[] | undefined {
  try {
    const parsed = JSON.parse(raw) as
      | { v?: number; items?: SearchEntry[] }
      | undefined;
    if (!parsed || parsed.v !== INDEX_CACHE_VERSION) return undefined;
    return Array.isArray(parsed.items) ? parsed.items : undefined;
  } catch {
    return undefined;
  }
}

function toTrendingShare(entry: SearchEntry): TrendingShare {
  return {
    id: entry.id,
    name: entry.n,
    description: entry.d,
    views: entry.v,
    previewFileId: entry.p?.id,
    previewKind: entry.p?.k,
    hasVideo: entry.p?.video === true,
    fileNames: entry.fn,
    fileCount: entry.fc,
    size: entry.s,
    createdAt: entry.c,
    updatedAt: entry.u,
  };
}
