import { createHash } from "crypto";
import { ThrottlerModuleOptions } from "@nestjs/throttler";
import { getVisitorKey } from "src/utils/visitorIdentity.util";
import { ValkeyService } from "./valkey.service";
import { ValkeyThrottlerStorage } from "./valkeyThrottler.storage";

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const VISITOR_RATE_LIMIT = positiveInt(process.env.VISITOR_RATE_LIMIT, 90);
const VISITOR_RATE_TTL_MS = positiveInt(
  process.env.VISITOR_RATE_TTL_MS,
  60 * 1000,
);
const VISITOR_RATE_BLOCK_MS = positiveInt(
  process.env.VISITOR_RATE_BLOCK_MS,
  60 * 1000,
);

/**
 * One shared bucket for every non-cacheable API route. The upstream per-IP
 * "default" limiter is intentionally gone: the only identifier is the client
 * IP defined in visitorIdentity.util (the User-Agent is attacker-controlled
 * and must not create a fresh bucket). Routes that are safe to cache at the
 * edge skip this bucket explicitly with
 * `@SkipThrottle({ default: true })`.
 */
export const createThrottlerOptions = (
  valkey: ValkeyService,
): ThrottlerModuleOptions => ({
  storage: new ValkeyThrottlerStorage(valkey),
  throttlers: [
    {
      name: "default",
      ttl: VISITOR_RATE_TTL_MS,
      limit: VISITOR_RATE_LIMIT,
      blockDuration: VISITOR_RATE_BLOCK_MS,
      // Client IP only, hashed before the bucket key is stored. Including the
      // attacker-controlled User-Agent would allow a trivial bucket rotation.
      getTracker: (req) =>
        typeof req.visitorKey === "string"
          ? req.visitorKey
          : getVisitorKey(req),
      // Routes without an explicit @Throttle override share one visitor
      // bucket, so the 90/min policy applies across the whole API. A route
      // override (comment, auth, upload, SEO, ...) gets its own bucket;
      // otherwise its stricter limit would consume the global counter and
      // reject a comment after a handful of ordinary page requests.
      generateKey: (context, tracker, throttlerName) => {
        const handler = context.getHandler();
        const classRef = context.getClass();
        const hasRouteLimit = [handler, classRef].some((target) =>
          Reflect.getOwnMetadataKeys(target).some((key) =>
            key.startsWith("THROTTLER:LIMIT"),
          ),
        );
        const prefix = hasRouteLimit
          ? `visitor:${classRef.name}-${handler.name}-${throttlerName}`
          : "visitor";
        return createHash("sha256")
          .update(`${prefix}:${tracker}`)
          .digest("hex");
      },
    },
  ],
});
