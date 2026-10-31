import { Injectable } from "@nestjs/common";
import {
  COUNTRY_FIELD_PREFIX,
  normalizeCountryCode,
} from "src/utils/country.util";
import {
  currentHour,
  HOUR_WINDOW,
  hourBucketTtlSeconds,
} from "src/utils/hourBucket.util";
import { ValkeyClient, ValkeyService } from "./valkey.service";

const METRICS_PREFIX = "pingvin:metrics:pageviews:hour:";
const WINDOW_HOURS = HOUR_WINDOW;
const BUCKET_TTL_SECONDS = hourBucketTtlSeconds(WINDOW_HOURS);
// Page-view counters do not need second-by-second freshness in the footer, so
// one aggregate read serves all page views in this window instead of reading
// 24 hourly hashes every ten seconds.
const AGGREGATE_CACHE_MS = 30 * 1000;
const MAX_TOP_COUNTRIES = 8;
const TOTAL_FIELD = "total";

// One small sorted set holds the all-time top external referrer domains. It is
// capped and expires on its own, keeping the Valkey footprint tiny; the admin
// page reads one page with ZRANGE + ZCARD.
const REFERRER_KEY = "pingvin:metrics:referrers";
const REFERRER_TTL_SECONDS = 90 * 24 * 60 * 60;
const REFERRER_MAX_ENTRIES = 2000;
const REFERRER_MAX_LENGTH = 253;
const MAX_REFERRER_PAGE_SIZE = 100;

type Bucket = {
  total: number;
  countries: Map<string, number>;
};

export type CountryCount = {
  country: string;
  count: number;
};

export type PageViewMetrics = {
  pageViewsLastDay: number;
  topCountriesLastDay: CountryCount[];
};

export type ReferrerEntry = {
  domain: string;
  views: number;
};

export type ReferrerPage = {
  referrers: ReferrerEntry[];
  total: number;
  page: number;
  pageSize: number;
};

@Injectable()
export class MetricsService {
  private readonly memory = new Map<number, Bucket>();
  private readonly referrerMemory = new Map<string, number>();
  private aggregate?: { at: number; value: PageViewMetrics };
  private aggregatePending?: Promise<PageViewMetrics>;

  constructor(private readonly valkey: ValkeyService) {}

  async recordPageView(country?: string): Promise<PageViewMetrics> {
    const code = normalizeCountryCode(country);
    const hour = currentHour();

    const incremented = await this.valkey.run(async (client) => {
      const key = bucketKey(hour);
      const multi = client.multi();
      multi.hIncrBy(key, TOTAL_FIELD, 1);
      if (code) multi.hIncrBy(key, `${COUNTRY_FIELD_PREFIX}${code}`, 1);
      multi.expire(key, BUCKET_TTL_SECONDS);
      await multi.exec();
      return true;
    });

    if (incremented) return this.getLastDay();
    this.aggregate = undefined;
    return this.recordMemory(code, hour);
  }

  /**
   * Counts one external referrer domain. Only hostnames reach this method;
   * direct visits, same-site navigations and malformed values are ignored.
   * Valkey is the primary store, with a bounded in-process map as fallback.
   */
  async recordReferrer(domain?: string): Promise<void> {
    const host = normalizeReferrer(domain);
    if (!host) return;

    const stored = await this.valkey.run(async (client) => {
      const multi = client.multi();
      multi.zIncrBy(REFERRER_KEY, 1, host);
      // Keep only the highest-count domains; the score is the view count.
      multi.zRemRangeByRank(
        REFERRER_KEY,
        0,
        -(REFERRER_MAX_ENTRIES + 1),
      );
      multi.expire(REFERRER_KEY, REFERRER_TTL_SECONDS);
      await multi.exec();
      return true;
    });
    if (stored) return;

    this.referrerMemory.set(host, (this.referrerMemory.get(host) ?? 0) + 1);
    if (this.referrerMemory.size <= REFERRER_MAX_ENTRIES) return;

    const lowest = [...this.referrerMemory.entries()].sort(
      (a, b) => a[1] - b[1],
    )[0];
    if (lowest) this.referrerMemory.delete(lowest[0]);
  }

  async getReferrers(
    page = 1,
    pageSize = 50,
  ): Promise<ReferrerPage> {
    const currentPage = Math.max(1, Math.floor(page) || 1);
    const size = Math.min(
      Math.max(1, Math.floor(pageSize) || 50),
      MAX_REFERRER_PAGE_SIZE,
    );
    const start = (currentPage - 1) * size;

    const remote = await this.valkey.run(async (client) => {
      const multi = client.multi();
      multi.zRangeWithScores(REFERRER_KEY, start, start + size - 1, {
        REV: true,
      });
      multi.zCard(REFERRER_KEY);
      const [items, total] = (await multi.exec()) as unknown as [
        { value: string; score: number }[] | null,
        number | null,
      ];
      return {
        referrers: (items ?? [])
          .filter((item) => !!item.value)
          .map((item) => ({
            domain: item.value,
            views: Number(item.score) || 0,
          })),
        total: Number(total ?? 0),
      };
    });
    if (remote) return { ...remote, page: currentPage, pageSize: size };

    const entries = [...this.referrerMemory.entries()]
      .map(([domain, views]) => ({ domain, views }))
      .sort((a, b) => b.views - a.views || a.domain.localeCompare(b.domain));

    return {
      referrers: entries.slice(start, start + size),
      total: entries.length,
      page: currentPage,
      pageSize: size,
    };
  }

  async getLastDay(): Promise<PageViewMetrics> {
    if (this.aggregate && Date.now() - this.aggregate.at < AGGREGATE_CACHE_MS) {
      return this.aggregate.value;
    }

    // Every page view reads the same 24 hourly buckets when the aggregate
    // expires. Coalesce those reads instead of sending one HGETALL batch per
    // concurrent visitor.
    if (!this.aggregatePending)
      this.aggregatePending = this.loadLastDay().finally(() => {
        this.aggregatePending = undefined;
      });
    return this.aggregatePending;
  }

  private async loadLastDay(): Promise<PageViewMetrics> {
    const hour = currentHour();
    const result = await this.valkey.run((client) =>
      this.readValkey(client, hour),
    );
    if (result) {
      this.aggregate = { at: Date.now(), value: result };
      return result;
    }

    this.aggregate = undefined;
    return this.readMemory(hour);
  }

  private async readValkey(
    client: ValkeyClient,
    hour: number,
  ): Promise<PageViewMetrics> {
    const multi = client.multi();
    for (let offset = 0; offset < WINDOW_HOURS; offset++)
      multi.hGetAll(bucketKey(hour - offset));

    const buckets = (await multi.exec()) as unknown as (Record<
      string,
      string
    > | null)[];
    return toMetrics(aggregateBuckets(buckets));
  }

  private recordMemory(
    country: string | undefined,
    hour: number,
  ): PageViewMetrics {
    for (const key of this.memory.keys()) {
      if (key <= hour - WINDOW_HOURS) this.memory.delete(key);
    }

    const bucket = this.memory.get(hour) ?? {
      total: 0,
      countries: new Map<string, number>(),
    };
    bucket.total++;
    if (country)
      bucket.countries.set(country, (bucket.countries.get(country) ?? 0) + 1);
    this.memory.set(hour, bucket);

    return this.readMemory(hour);
  }

  private readMemory(hour: number): PageViewMetrics {
    const countries = new Map<string, number>();
    let total = 0;

    for (let offset = 0; offset < WINDOW_HOURS; offset++) {
      const bucket = this.memory.get(hour - offset);
      if (!bucket) continue;
      total += bucket.total;
      for (const [code, count] of bucket.countries)
        countries.set(code, (countries.get(code) ?? 0) + count);
    }

    return toMetrics({ total, countries });
  }
}

function bucketKey(hour: number) {
  return `${METRICS_PREFIX}${hour}`;
}

function normalizeReferrer(domain?: string): string | undefined {
  if (typeof domain !== "string") return undefined;
  const host = domain.trim().toLowerCase().replace(/^www\./, "");
  if (
    !host ||
    host.length > REFERRER_MAX_LENGTH ||
    !host.includes(".") ||
    !/^[a-z0-9.-]+$/.test(host) ||
    // IP addresses are not domains and would make the list noisy.
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
  )
    return undefined;
  return host;
}

function aggregateBuckets(
  buckets: (Record<string, string> | null | undefined)[],
): Bucket {
  const countries = new Map<string, number>();
  let total = 0;

  for (const bucket of buckets) {
    if (!bucket) continue;
    for (const [field, value] of Object.entries(bucket)) {
      const count = Number(value);
      if (!Number.isFinite(count)) continue;
      if (field === TOTAL_FIELD) total += count;
      else if (field.startsWith(COUNTRY_FIELD_PREFIX)) {
        const country = field.slice(COUNTRY_FIELD_PREFIX.length);
        countries.set(country, (countries.get(country) ?? 0) + count);
      }
    }
  }

  return { total, countries };
}

function toMetrics(aggregate: Bucket): PageViewMetrics {
  const countries = [...aggregate.countries.entries()]
    .sort(([aCode, aCount], [bCode, bCount]) => {
      return bCount - aCount || aCode.localeCompare(bCode);
    })
    .slice(0, MAX_TOP_COUNTRIES)
    .map(([country, count]) => ({ country, count }));

  return {
    pageViewsLastDay: aggregate.total,
    topCountriesLastDay: countries,
  };
}
