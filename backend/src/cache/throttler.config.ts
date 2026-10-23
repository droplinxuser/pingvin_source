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

export const createThrottlerOptions = (
  valkey: ValkeyService,
): ThrottlerModuleOptions => ({
  storage: new ValkeyThrottlerStorage(valkey),
  throttlers: [
    {
      name: "default",
      ttl: 60 * 1000,
      limit: positiveInt(process.env.THROTTLE_LIMIT, 100),
      blockDuration: 60 * 1000,
    },
    {
      name: "visitor",
      ttl: VISITOR_RATE_TTL_MS,
      limit: VISITOR_RATE_LIMIT,
      blockDuration: VISITOR_RATE_BLOCK_MS,
      // IP + browser User-Agent, hashed before the bucket key is stored.
      getTracker: (req) =>
        typeof req.visitorKey === "string"
          ? req.visitorKey
          : getVisitorKey(req),
      generateKey: (_context, tracker) =>
        createHash("sha256").update(`visitor:${tracker}`).digest("hex"),
    },
  ],
});
