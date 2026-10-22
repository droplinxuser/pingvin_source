import { Injectable } from "@nestjs/common";
import { ValkeyClient, ValkeyService } from "./valkey.service";

const METRICS_PREFIX = "pingvin:metrics:pageviews:";
const COUNTRY_VISITORS_PREFIX = "pingvin:metrics:visitors:";
const WINDOW_MINUTES = 60;
const WINDOW_MS = WINDOW_MINUTES * 60 * 1000;
const BUCKET_TTL_SECONDS = 2 * 60 * 60;
const MAX_TOP_COUNTRIES = 5;
const TOTAL_FIELD = "total";
const COUNTRY_FIELD = "c:";

type Bucket = {
  total: number;
  countries: Map<string, number>;
};

type Aggregate = {
  total: number;
  countries: Map<string, number>;
};

export type CountryCount = {
  country: string;
  count: number;
};

export type PageViewMetrics = {
  pageViewsLastHour: number;
  topCountriesLastHour: CountryCount[];
};

@Injectable()
export class MetricsService {
  private readonly memory = new Map<number, Bucket>();
  private readonly memoryVisitors = new Map<string, Map<string, number>>();

  constructor(private readonly valkey: ValkeyService) {}

  async recordPageView(
    country?: string,
    visitorKey?: string,
  ): Promise<PageViewMetrics> {
    const normalizedCountry = normalizeCountry(country);
    const minute = currentMinute();
    const now = Date.now();

    const result = await this.valkey.run(async (client) => {
      const key = bucketKey(minute);
      const multi = client.multi();
      multi.hIncrBy(key, TOTAL_FIELD, 1);
      if (normalizedCountry)
        multi.hIncrBy(key, `${COUNTRY_FIELD}${normalizedCountry}`, 1);
      multi.expire(key, BUCKET_TTL_SECONDS);

      if (normalizedCountry && visitorKey) {
        const visitorsKey = countryVisitorsKey(normalizedCountry);
        multi.zAdd(visitorsKey, { score: now, value: visitorKey });
        multi.zRemRangeByScore(visitorsKey, "-inf", String(now - WINDOW_MS));
        multi.expire(visitorsKey, BUCKET_TTL_SECONDS);
      }
      await multi.exec();

      return this.readValkey(client, minute);
    });

    return (
      result ?? this.recordMemory(normalizedCountry, visitorKey, minute, now)
    );
  }

  async getLastHour(): Promise<PageViewMetrics> {
    const minute = currentMinute();
    const result = await this.valkey.run((client) =>
      this.readValkey(client, minute),
    );
    return result ?? this.readMemory(minute);
  }

  private async readValkey(
    client: ValkeyClient,
    minute: number,
  ): Promise<PageViewMetrics> {
    const multi = client.multi();
    for (let offset = 0; offset < WINDOW_MINUTES; offset++)
      multi.hGetAll(bucketKey(minute - offset));

    const buckets = (await multi.exec()) as unknown as (Record<
      string,
      string
    > | null)[];
    const aggregate = aggregateBuckets(buckets);
    const visitors = await this.readValkeyVisitors(client, aggregate.countries);
    return toMetrics(aggregate, visitors);
  }

  private async readValkeyVisitors(
    client: ValkeyClient,
    pageViewsByCountry: Map<string, number>,
  ): Promise<Map<string, number>> {
    const countries = [...pageViewsByCountry.keys()];
    if (countries.length === 0) return new Map();

    const multi = client.multi();
    for (const country of countries) multi.zCard(countryVisitorsKey(country));
    const counts = (await multi.exec()) as unknown as number[];
    return new Map(
      countries.map((country, index) => [country, Number(counts[index]) || 0]),
    );
  }

  private recordMemory(
    country: string | undefined,
    visitorKey: string | undefined,
    minute: number,
    now: number,
  ): PageViewMetrics {
    for (const key of this.memory.keys()) {
      if (key <= minute - WINDOW_MINUTES) this.memory.delete(key);
    }

    const bucket = this.memory.get(minute) ?? {
      total: 0,
      countries: new Map<string, number>(),
    };
    bucket.total++;
    if (country)
      bucket.countries.set(country, (bucket.countries.get(country) ?? 0) + 1);
    this.memory.set(minute, bucket);

    if (country && visitorKey) {
      const visitors =
        this.memoryVisitors.get(country) ?? new Map<string, number>();
      visitors.set(visitorKey, now);
      this.memoryVisitors.set(country, visitors);
    }
    this.pruneMemoryVisitors(now);

    return this.readMemory(minute, now);
  }

  private readMemory(minute: number, now = Date.now()): PageViewMetrics {
    const countries = new Map<string, number>();
    let total = 0;

    for (let offset = 0; offset < WINDOW_MINUTES; offset++) {
      const bucket = this.memory.get(minute - offset);
      if (!bucket) continue;
      total += bucket.total;
      for (const [code, count] of bucket.countries)
        countries.set(code, (countries.get(code) ?? 0) + count);
    }

    const visitors = new Map<string, number>();
    for (const [country, entries] of this.memoryVisitors) {
      let count = 0;
      for (const timestamp of entries.values()) {
        if (timestamp >= now - WINDOW_MS) count++;
      }
      if (count > 0) visitors.set(country, count);
    }

    return toMetrics({ total, countries }, visitors);
  }

  private pruneMemoryVisitors(now: number) {
    const cutoff = now - WINDOW_MS;
    for (const [country, visitors] of this.memoryVisitors) {
      for (const [key, timestamp] of visitors) {
        if (timestamp < cutoff) visitors.delete(key);
      }
      if (visitors.size === 0) this.memoryVisitors.delete(country);
    }
  }
}

function currentMinute() {
  return Math.floor(Date.now() / 60_000);
}

function bucketKey(minute: number) {
  return `${METRICS_PREFIX}${minute}`;
}

function countryVisitorsKey(country: string) {
  return `${COUNTRY_VISITORS_PREFIX}${country}`;
}

function normalizeCountry(country?: string) {
  const code = country?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) && code !== "XX" ? code : undefined;
}

function aggregateBuckets(
  buckets: (Record<string, string> | null | undefined)[],
): Aggregate {
  const countries = new Map<string, number>();
  let total = 0;

  for (const bucket of buckets) {
    if (!bucket) continue;
    for (const [field, value] of Object.entries(bucket)) {
      const count = Number(value);
      if (!Number.isFinite(count)) continue;
      if (field === TOTAL_FIELD) total += count;
      else if (field.startsWith(COUNTRY_FIELD)) {
        const country = field.slice(COUNTRY_FIELD.length);
        countries.set(country, (countries.get(country) ?? 0) + count);
      }
    }
  }

  return { total, countries };
}

function toMetrics(
  aggregate: Aggregate,
  uniqueVisitors: Map<string, number>,
): PageViewMetrics {
  const countries = [...aggregate.countries.entries()]
    .map(([country, pageViews]) => ({
      country,
      count: uniqueVisitors.get(country) || pageViews,
      pageViews,
    }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        b.pageViews - a.pageViews ||
        a.country.localeCompare(b.country),
    )
    .slice(0, MAX_TOP_COUNTRIES)
    .map(({ country, count }) => ({ country, count }));

  return {
    pageViewsLastHour: aggregate.total,
    topCountriesLastHour: countries,
  };
}
