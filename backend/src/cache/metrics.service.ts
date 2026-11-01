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

// All-time totals live in one small hash. Country codes and the normalized
// OS/browser names are a finite vocabulary, so the hash cannot grow with
// visitor traffic. There is deliberately no TTL: these are the "since launch"
// numbers used by /stats.
const OVERALL_KEY = "pingvin:metrics:all";
const OS_FIELD_PREFIX = "o:";
const BROWSER_FIELD_PREFIX = "b:";
const MAX_TOP_COUNTRIES_ALL = 20;
const MAX_TOP_NAMES = 20;

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

export type NameCount = {
  name: string;
  count: number;
};

export type OverallMetrics = {
  totalPageViews: number;
  topCountries: CountryCount[];
  topOperatingSystems: NameCount[];
  topBrowsers: NameCount[];
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
  private readonly overallMemory = new Map<string, number>();
  private aggregate?: { at: number; value: PageViewMetrics };
  private aggregatePending?: Promise<PageViewMetrics>;
  private overallCache?: { at: number; value: OverallMetrics };
  private overallPending?: Promise<OverallMetrics>;

  constructor(private readonly valkey: ValkeyService) {}

  async recordPageView(
    country?: string,
    os?: string,
    browser?: string,
  ): Promise<PageViewMetrics> {
    const code = normalizeCountryCode(country);
    const osName = normalizeOs(os);
    const browserName = normalizeBrowser(browser);
    const hour = currentHour();

    const incremented = await this.valkey.run(async (client) => {
      const key = bucketKey(hour);
      const multi = client.multi();
      multi.hIncrBy(key, TOTAL_FIELD, 1);
      if (code) multi.hIncrBy(key, `${COUNTRY_FIELD_PREFIX}${code}`, 1);
      multi.expire(key, BUCKET_TTL_SECONDS);

      // All-time totals, written in the same round trip as the hourly bucket.
      multi.hIncrBy(OVERALL_KEY, TOTAL_FIELD, 1);
      if (code)
        multi.hIncrBy(OVERALL_KEY, `${COUNTRY_FIELD_PREFIX}${code}`, 1);
      multi.hIncrBy(
        OVERALL_KEY,
        `${OS_FIELD_PREFIX}${osName}`,
        1,
      );
      multi.hIncrBy(
        OVERALL_KEY,
        `${BROWSER_FIELD_PREFIX}${browserName}`,
        1,
      );
      await multi.exec();
      return true;
    });

    this.overallCache = undefined;
    if (incremented) return this.getLastDay();
    this.aggregate = undefined;
    return this.recordMemory(code, hour, osName, browserName);
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

  /**
   * All-time page-view totals plus the top countries, operating systems and
   * browsers. Served from a 30-second process cache so /stats and its backend
   * cache miss do not read the overall hash for every requester.
   */
  async getOverallStats(): Promise<OverallMetrics> {
    if (
      this.overallCache &&
      Date.now() - this.overallCache.at < AGGREGATE_CACHE_MS
    ) {
      return this.overallCache.value;
    }

    if (!this.overallPending)
      this.overallPending = this.loadOverall().finally(() => {
        this.overallPending = undefined;
      });
    return this.overallPending;
  }

  private async loadOverall(): Promise<OverallMetrics> {
    const remote = await this.valkey.run((client) =>
      client.hGetAll(OVERALL_KEY),
    );
    // hGetAll returns {} for a fresh install; only `undefined` means Valkey
    // was unavailable and the in-process fallback should be read.
    const fields = remote ?? Object.fromEntries(this.overallMemory);
    const value = toOverallMetrics(fields);
    this.overallCache = { at: Date.now(), value };
    return value;
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
    os: string,
    browser: string,
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
    this.recordOverallMemory(country, os, browser);

    return this.readMemory(hour);
  }

  private recordOverallMemory(
    country: string | undefined,
    os: string,
    browser: string,
  ) {
    const bump = (field: string) =>
      this.overallMemory.set(field, (this.overallMemory.get(field) ?? 0) + 1);
    bump(TOTAL_FIELD);
    if (country) bump(`${COUNTRY_FIELD_PREFIX}${country}`);
    bump(`${OS_FIELD_PREFIX}${os}`);
    bump(`${BROWSER_FIELD_PREFIX}${browser}`);
    this.overallCache = undefined;
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

/**
 * Collapses the many OS strings reported by browsers into one small,
 * comparable vocabulary. Android is checked before Linux because Android UAs
 * also contain "Linux"; iOS is checked before macOS because iPads advertise
 * "like Mac OS X".
 */
function normalizeOs(value?: string): string {
  const text = (value ?? "").trim().toLowerCase();
  if (!text || /bot|crawl|spider|slurp|headless/.test(text)) return "Other";
  if (text.includes("android")) return "Android";
  if (text.includes("ios") || text.includes("iphone") || text.includes("ipad"))
    return "iOS";
  if (text.includes("chrome os") || text.includes("chromeos")) return "ChromeOS";
  if (text.includes("mac")) return "macOS";
  if (text.includes("windows")) return "Windows";
  if (text.includes("linux")) return "Linux";
  return "Other";
}

/**
 * Same idea for browsers. Edge/Opera/Brave/Samsung are checked first because
 * their UA strings also contain Chrome or Safari.
 */
function normalizeBrowser(value?: string): string {
  const text = (value ?? "").trim().toLowerCase();
  if (!text || /bot|crawl|spider|slurp|headless/.test(text)) return "Other";
  if (text.includes("edge") || text.includes("edg/")) return "Edge";
  if (text.includes("opera") || text.includes("opr/")) return "Opera";
  if (text.includes("samsung")) return "Samsung Internet";
  if (text.includes("brave")) return "Brave";
  if (text.includes("firefox")) return "Firefox";
  if (text.includes("chrome") || text.includes("chromium")) return "Chrome";
  if (text.includes("safari")) return "Safari";
  return "Other";
}

function rankCounts(
  counts: Map<string, number>,
  limit: number,
): [string, number][] {
  return [...counts.entries()]
    .sort(([aName, aCount], [bName, bCount]) => {
      return bCount - aCount || aName.localeCompare(bName);
    })
    .slice(0, limit);
}

function toOverallMetrics(
  fields: Record<string, string | number>,
): OverallMetrics {
  let totalPageViews = 0;
  const countries = new Map<string, number>();
  const operatingSystems = new Map<string, number>();
  const browsers = new Map<string, number>();

  for (const [field, rawValue] of Object.entries(fields)) {
    const count = Number(rawValue);
    if (!Number.isFinite(count) || count <= 0) continue;
    if (field === TOTAL_FIELD) totalPageViews += count;
    else if (field.startsWith(COUNTRY_FIELD_PREFIX)) {
      const country = field.slice(COUNTRY_FIELD_PREFIX.length);
      countries.set(country, (countries.get(country) ?? 0) + count);
    } else if (field.startsWith(OS_FIELD_PREFIX)) {
      const name = field.slice(OS_FIELD_PREFIX.length);
      operatingSystems.set(name, (operatingSystems.get(name) ?? 0) + count);
    } else if (field.startsWith(BROWSER_FIELD_PREFIX)) {
      const name = field.slice(BROWSER_FIELD_PREFIX.length);
      browsers.set(name, (browsers.get(name) ?? 0) + count);
    }
  }

  return {
    totalPageViews,
    topCountries: rankCounts(countries, MAX_TOP_COUNTRIES_ALL).map(
      ([country, count]) => ({ country, count }),
    ),
    topOperatingSystems: rankCounts(
      operatingSystems,
      MAX_TOP_NAMES,
    ).map(([name, count]) => ({ name, count })),
    topBrowsers: rankCounts(browsers, MAX_TOP_NAMES).map(
      ([name, count]) => ({ name, count }),
    ),
  };
}
