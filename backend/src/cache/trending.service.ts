import { Injectable } from "@nestjs/common";
import { getFileMimeType } from "src/utils/mime.util";
import { ValkeyClient, ValkeyService } from "./valkey.service";

const VIEW_KEY_PREFIX = "pingvin:trending:views:";
const META_KEY_PREFIX = "pingvin:trending:meta:";
const RANK_KEY = "pingvin:trending:rank";
const WINDOW_HOURS = 24;
const VIEW_TTL_SECONDS = (WINDOW_HOURS + 1) * 60 * 60;
const META_TTL_SECONDS = 50 * 60 * 60;
const MAX_SHARE_AGE_MS = 48 * 60 * 60 * 1000;
const CANDIDATE_LIMIT = 100;
const RESULT_LIMIT = 9;
const RESULT_CACHE_MS = 30 * 1000;

type MediaKind = "image" | "video";

export type TrendingShare = {
  id: string;
  name?: string;
  views: number;
  previewFileId: string;
  previewKind: MediaKind;
};

type TrendingMeta = TrendingShare & {
  createdAt: string;
};

type TrendingSource = {
  id: string;
  name?: string | null;
  createdAt: Date | string;
  views: number;
  files?: { id: string; name: string }[];
};

/**
 * Ranks public shares by their views over the last 24 hours. Both the counters
 * and the ranking are kept in Valkey; SQLite is only read by the share page
 * that produced the view, never by this service.
 */
@Injectable()
export class TrendingService {
  private cached?: { at: number; items: TrendingShare[] };

  constructor(private readonly valkey: ValkeyService) {}

  async recordView(share: TrendingSource): Promise<void> {
    if (Date.now() - new Date(share.createdAt).getTime() > MAX_SHARE_AGE_MS)
      return;

    const preview = findPreview(share.files);
    if (!preview) return;

    const meta: TrendingMeta = {
      id: share.id,
      name: share.name || undefined,
      views: share.views,
      previewFileId: preview.id,
      previewKind: preview.kind,
      createdAt: new Date(share.createdAt).toISOString(),
    };

    const stored = await this.valkey.run(async (client) => {
      const viewKey = viewKeyFor(currentHour());
      const metaKey = metaKeyFor(currentDay());
      const multi = client.multi();
      multi.zIncrBy(viewKey, 1, share.id);
      multi.expire(viewKey, VIEW_TTL_SECONDS);
      multi.hSet(metaKey, share.id, JSON.stringify(meta));
      multi.expire(metaKey, META_TTL_SECONDS);
      await multi.exec();
      return true;
    });

    if (stored) this.cached = undefined;
  }

  async getTrending(): Promise<TrendingShare[]> {
    if (this.cached && Date.now() - this.cached.at < RESULT_CACHE_MS)
      return this.cached.items;

    const items = await this.valkey.run((client) => this.read(client));
    if (!items) return [];
    this.cached = { at: Date.now(), items };
    return items;
  }

  /**
   * Removes a share from the current ranking when it is edited, expires or is
   * deleted. Score buckets are short-lived, so only metadata has to be purged.
   */
  async invalidate(shareIds: string | string[]): Promise<void> {
    const ids = Array.isArray(shareIds) ? shareIds : [shareIds];
    if (ids.length === 0) return;
    this.cached = undefined;

    const day = currentDay();
    await this.valkey.run(async (client) => {
      const multi = client.multi();
      for (const id of ids) {
        multi.hDel(metaKeyFor(day), id);
        multi.hDel(metaKeyFor(day - 1), id);
      }
      await multi.exec();
    });
  }

  private async read(client: ValkeyClient): Promise<TrendingShare[]> {
    const hour = currentHour();
    const keys = Array.from({ length: WINDOW_HOURS }, (_, offset) =>
      viewKeyFor(hour - offset),
    );
    const multi = client.multi();
    multi.zUnionStore(RANK_KEY, keys);
    multi.zRangeWithScores(RANK_KEY, 0, CANDIDATE_LIMIT - 1, { REV: true });
    multi.del(RANK_KEY);
    const replies = await multi.exec();
    const ranked = replies?.[1] as unknown as
      | {
          value: string;
          score: number;
        }[]
      | null;
    if (!ranked?.length) return [];

    const ids = ranked.map((item) => item.value);
    const day = currentDay();
    const metaMulti = client.multi();
    metaMulti.hmGet(metaKeyFor(day), ids);
    metaMulti.hmGet(metaKeyFor(day - 1), ids);
    const metaReplies = await metaMulti.exec();
    const metas = new Map<string, TrendingMeta>();

    for (const reply of metaReplies ?? []) {
      for (const value of (reply as (string | null)[]) ?? []) {
        if (!value) continue;
        try {
          const meta = JSON.parse(value) as TrendingMeta;
          if (meta?.id) metas.set(meta.id, meta);
        } catch {
          // Ignore malformed cache entries; they expire with the day key.
        }
      }
    }

    const now = Date.now();
    const items: TrendingShare[] = [];
    for (const { value: id } of ranked) {
      const meta = metas.get(id);
      if (!meta) continue;
      if (now - new Date(meta.createdAt).getTime() > MAX_SHARE_AGE_MS) continue;

      items.push({
        id: meta.id,
        name: meta.name,
        views: meta.views,
        previewFileId: meta.previewFileId,
        previewKind: meta.previewKind,
      });
      if (items.length === RESULT_LIMIT) break;
    }
    return items;
  }
}

function findPreview(files?: { id: string; name: string }[]) {
  for (const file of files ?? []) {
    const mimeType = getFileMimeType(file.name, false);
    if (mimeType.startsWith("image/"))
      return { id: file.id, kind: "image" as MediaKind };
    if (mimeType.startsWith("video/"))
      return { id: file.id, kind: "video" as MediaKind };
  }
  return undefined;
}

function currentHour() {
  return Math.floor(Date.now() / 3_600_000);
}

function currentDay() {
  return Math.floor(Date.now() / 86_400_000);
}

function viewKeyFor(hour: number) {
  return `${VIEW_KEY_PREFIX}${hour}`;
}

function metaKeyFor(day: number) {
  return `${META_KEY_PREFIX}${day}`;
}
