import { Logger } from "@nestjs/common";
import { ThrottlerStorage, ThrottlerStorageService } from "@nestjs/throttler";
import { createClient } from "@keyv/redis";

type ThrottlerStorageRecord = Awaited<
  ReturnType<ThrottlerStorage["increment"]>
>;

const INCREMENT_SCRIPT = `
local key = KEYS[1]
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockDuration = tonumber(ARGV[3])
local now = tonumber(ARGV[4])

local state = redis.call('HMGET', key, 'hits', 'expiresAt', 'blockedUntil')
local hits = tonumber(state[1] or '0')
local expiresAt = tonumber(state[2] or '0')
local blockedUntil = tonumber(state[3] or '0')

if blockedUntil > now then
  return {hits, math.ceil((expiresAt - now) / 1000), 1, math.ceil((blockedUntil - now) / 1000)}
end

if blockedUntil > 0 and blockedUntil <= now then
  hits = 0
  expiresAt = now + ttl
  blockedUntil = 0
end

if expiresAt <= now then
  hits = 0
  expiresAt = now + ttl
end

hits = hits + 1

if hits > limit then
  local blockExpiresAt = now + blockDuration
  redis.call('HSET', key, 'hits', hits, 'expiresAt', expiresAt, 'blockedUntil', blockExpiresAt)
  redis.call('PEXPIRE', key, math.max(ttl, blockDuration) + 1000)
  return {hits, math.ceil((expiresAt - now) / 1000), 1, math.ceil((blockExpiresAt - now) / 1000)}
end

redis.call('HSET', key, 'hits', hits, 'expiresAt', expiresAt, 'blockedUntil', 0)
redis.call('PEXPIRE', key, math.max(ttl, blockDuration) + 1000)
return {hits, math.ceil((expiresAt - now) / 1000), 0, 0}
`;

export class ValkeyThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(ValkeyThrottlerStorage.name);
  private readonly fallback = new ThrottlerStorageService();
  private client: ReturnType<typeof createClient> | null = null;

  constructor(
    private readonly enabled: boolean,
    private readonly url: string,
  ) {}

  async initialize() {
    if (!this.enabled) return;

    try {
      const client = createClient({
        url: this.url,
        disableOfflineQueue: true,
        socket: {
          connectTimeout: 2000,
          reconnectStrategy: false,
        },
      });
      client.on("error", (error) => {
        this.logger.debug(
          `Valkey throttling connection error: ${error.message}`,
        );
      });
      await client.connect();
      this.client = client;
    } catch (error) {
      this.logger.warn(
        `Valkey throttling unavailable; using in-memory fallback: ${error}`,
      );
    }
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    if (!this.client) {
      return this.fallback.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    }

    try {
      const result = (await this.client.eval(INCREMENT_SCRIPT, {
        keys: [`pingvin:throttle:${throttlerName}:${key}`],
        arguments: [
          String(ttl),
          String(limit),
          String(blockDuration),
          String(Date.now()),
        ],
      })) as unknown as [number, number, number, number];

      return {
        totalHits: Number(result[0]),
        timeToExpire: Number(result[1]),
        isBlocked: Number(result[2]) === 1,
        timeToBlockExpire: Number(result[3]),
      };
    } catch (error) {
      this.logger.warn(
        `Valkey throttling failed; using in-memory fallback: ${error}`,
      );
      const client = this.client;
      this.client = null;
      await client?.disconnect().catch(() => {});
      return this.fallback.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    }
  }

  async onApplicationShutdown() {
    const client = this.client;
    this.client = null;
    await client?.quit().catch(() => {});
    this.fallback.onApplicationShutdown();
  }
}
