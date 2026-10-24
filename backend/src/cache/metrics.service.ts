import { Injectable } from "@nestjs/common";
import { ValkeyClient, ValkeyService } from "./valkey.service";

const METRICS_PREFIX = "pingvin:metrics:pageviews:hour:";
const WINDOW_HOURS = 24;
const BUCKET_TTL_SECONDS = (WINDOW_HOURS + 1) * 60 * 60;
// Page-view counters do not need second-by-second freshness in the footer, so
// one aggregate read serves all page views in this window instead of reading
// 24 hourly hashes every ten seconds.
const AGGREGATE_CACHE_MS = 30 * 1000;
const MAX_TOP_COUNTRIES = 8;
const TOTAL_FIELD = "total";
const COUNTRY_FIELD = "c:";

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

@Injectable()
export class MetricsService {
  private readonly memory = new Map<number, Bucket>();
  private aggregate?: { at: number; value: PageViewMetrics };

  constructor(private readonly valkey: ValkeyService) {}

  async recordPageView(country?: string): Promise<PageViewMetrics> {
    const code = normalizeCountry(country);
    const hour = currentHour();

    const incremented = await this.valkey.run(async (client) => {
      const key = bucketKey(hour);
      const multi = client.multi();
      multi.hIncrBy(key, TOTAL_FIELD, 1);
      if (code) multi.hIncrBy(key, `${COUNTRY_FIELD}${code}`, 1);
      multi.expire(key, BUCKET_TTL_SECONDS);
      await multi.exec();
      return true;
    });

    if (incremented) return this.getLastDay();
    this.aggregate = undefined;
    return this.recordMemory(code, hour);
  }

  async getLastDay(): Promise<PageViewMetrics> {
    if (
      this.aggregate &&
      Date.now() - this.aggregate.at < AGGREGATE_CACHE_MS
    ) {
      return this.aggregate.value;
    }

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

function currentHour() {
  return Math.floor(Date.now() / 3_600_000);
}

function bucketKey(hour: number) {
  return `${METRICS_PREFIX}${hour}`;
}

function normalizeCountry(country?: string) {
  const code = country?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) && code !== "XX" ? code : undefined;
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
      else if (field.startsWith(COUNTRY_FIELD)) {
        const country = field.slice(COUNTRY_FIELD.length);
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
