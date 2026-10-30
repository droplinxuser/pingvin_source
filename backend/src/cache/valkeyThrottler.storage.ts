import { ThrottlerStorage, ThrottlerStorageService } from "@nestjs/throttler";
import { ValkeyService } from "./valkey.service";

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

/**
 * Stores throttler buckets in the shared Valkey connection so multiple
 * instances and restarts see the same limits. Visitor keys are already SHA-256
 * hashes of the client IP tracker, so raw client identifiers are not stored.
 * The in-memory store remains the fallback when Valkey is disabled or
 * unreachable.
 */
export class ValkeyThrottlerStorage implements ThrottlerStorage {
  private readonly fallback = new ThrottlerStorageService();

  constructor(private readonly valkey: Pick<ValkeyService, "run">) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const result = await this.valkey.run((client) =>
      client.eval(INCREMENT_SCRIPT, {
        keys: [`pingvin:throttle:${throttlerName}:${key}`],
        arguments: [
          String(ttl),
          String(limit),
          String(blockDuration),
          String(Date.now()),
        ],
      }),
    );

    if (!Array.isArray(result)) {
      return this.fallback.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    }

    return {
      totalHits: Number(result[0]),
      timeToExpire: Number(result[1]),
      isBlocked: Number(result[2]) === 1,
      timeToBlockExpire: Number(result[3]),
    };
  }

  onApplicationShutdown() {
    this.fallback.onApplicationShutdown();
  }
}
