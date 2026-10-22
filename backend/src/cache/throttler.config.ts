import { createHash } from "crypto";
import { ThrottlerModuleOptions } from "@nestjs/throttler";
import { ConfigService } from "src/config/config.service";
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

export const createThrottlerOptions = async (
  configService: ConfigService,
): Promise<ThrottlerModuleOptions> => {
  const storage = new ValkeyThrottlerStorage(
    configService.get("cache.redis-enabled") === true,
    configService.get("cache.redis-url"),
  );
  await storage.initialize();

  return {
    storage,
    throttlers: [
      {
        name: "default",
        ttl: 60 * 1000,
        limit: parseInt(process.env.THROTTLE_LIMIT || "100"),
        blockDuration: 60 * 1000,
      },
      {
        name: "visitor",
        ttl: VISITOR_RATE_TTL_MS,
        limit: VISITOR_RATE_LIMIT,
        blockDuration: VISITOR_RATE_BLOCK_MS,
        getTracker: (req) =>
          typeof req.visitorKey === "string" ? req.visitorKey : `ip:${req.ip}`,
        generateKey: (_context, tracker) =>
          createHash("sha256")
            .update(`visitor:${tracker}`)
            .digest("hex"),
      },
    ],
  };
};
