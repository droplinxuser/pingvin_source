import type { NextRequest } from "next/server";

/**
 * Page-level rate limit for the Next server.
 *
 * Backend API routes are limited by the Nest visitor bucket. Cloudflare absorbs
 * cacheable HTML before it reaches this layer, so only the non-cacheable page
 * responses are counted here. The identifier is the same visitor key used by
 * the API limiter: the client IP (Cloudflare / proxy aware), hashed before it
 * is stored. No cookie is issued.
 */
const LIMIT = 90;
const WINDOW_MS = 60 * 1000;
const BLOCK_MS = 60 * 1000;
const MAX_BUCKETS = 10_000;

type Bucket = {
  count: number;
  resetAt: number;
  blockedUntil: number;
};

const buckets = new Map<string, Bucket>();

const clientIp = (request: NextRequest): string => {
  const cloudflare = request.headers.get("cf-connecting-ip")?.trim();
  if (cloudflare) return cloudflare;

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
};

const hashVisitor = async (request: NextRequest): Promise<string> => {
  // IP only: the User-Agent is attacker-controlled and would let a script
  // rotate its own bucket to bypass the page limit.
  const value = `ip:${clientIp(request)}`;

  try {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    // Middleware always runs in a runtime with WebCrypto. Keep a stable
    // fallback so a missing implementation cannot disable the limiter.
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv:${hash >>> 0}`;
  }
};

const prune = (now: number) => {
  if (buckets.size <= MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now && bucket.blockedUntil <= now)
      buckets.delete(key);
  }
  while (buckets.size > MAX_BUCKETS) {
    const oldest = buckets.keys().next().value;
    if (!oldest) break;
    buckets.delete(oldest);
  }
};

export async function checkPageRateLimit(
  request: NextRequest,
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const key = await hashVisitor(request);
  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS, blockedUntil: 0 };
    buckets.set(key, bucket);
  }

  if (bucket.blockedUntil > now) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000)),
    };
  }

  bucket.count += 1;
  if (bucket.count > LIMIT) {
    bucket.blockedUntil = now + BLOCK_MS;
    prune(now);
    return { allowed: false, retryAfter: Math.ceil(BLOCK_MS / 1000) };
  }

  prune(now);
  return { allowed: true };
}
