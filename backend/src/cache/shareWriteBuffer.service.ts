import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { PrismaService } from "src/prisma/prisma.service";
import { ValkeyService } from "./valkey.service";

const VIEW_TOTAL_PREFIX = "pingvin:share:views:";
const VIEW_PENDING_PREFIX = "pingvin:share:views:pending:";
const VIEW_PENDING_SET = "pingvin:share:views:pending";
const EXPIRATION_HASH = "pingvin:share:expirations";
const FLUSH_INTERVAL_MS = 20 * 1000;

const READ_TOTAL_SCRIPT = `
local total = tonumber(redis.call('GET', KEYS[1]))
local baseline = tonumber(ARGV[1])
if not total or total < baseline then
  total = baseline
  redis.call('SET', KEYS[1], total)
end
return total
`;

const INCREMENT_SCRIPT = `
local total = tonumber(redis.call('GET', KEYS[1]))
local baseline = tonumber(ARGV[2])
if not total or total < baseline then
  total = baseline
  redis.call('SET', KEYS[1], total)
end
local max = tonumber(ARGV[1])
if max > 0 and total >= max then
  return {0, total}
end
total = redis.call('INCR', KEYS[1])
redis.call('INCR', KEYS[2])
redis.call('SADD', KEYS[3], ARGV[3])
return {1, total}
`;

export type ViewResult =
  | { status: "ok"; views: number }
  | { status: "limit"; views: number }
  | { status: "missing"; views: number };

@Injectable()
export class ShareWriteBufferService
  implements OnModuleInit, BeforeApplicationShutdown
{
  private readonly logger = new Logger(ShareWriteBufferService.name);
  private timer?: NodeJS.Timeout;
  private flushing = false;

  constructor(
    private readonly valkey: ValkeyService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    this.timer.unref?.();
  }

  async getViews(shareId: string, dbViews: number): Promise<number> {
    const total = await this.valkey.run((client) =>
      client.eval(READ_TOTAL_SCRIPT, {
        keys: [totalKey(shareId)],
        arguments: [String(dbViews)],
      }),
    );

    const views = Number(total);
    return Number.isFinite(views) ? views : dbViews;
  }

  async recordView(
    shareId: string,
    dbViews: number,
    maxViews?: number | null,
  ): Promise<ViewResult> {
    const result = await this.valkey.run((client) =>
      client.eval(INCREMENT_SCRIPT, {
        keys: [totalKey(shareId), pendingKey(shareId), VIEW_PENDING_SET],
        arguments: [String(maxViews ?? 0), String(dbViews), shareId],
      }),
    );

    if (!Array.isArray(result))
      return this.recordViewInDatabase(shareId, maxViews);

    const allowed = Number(result[0]) === 1;
    const views = Number(result[1]);
    return allowed ? { status: "ok", views } : { status: "limit", views };
  }

  async queueExpiration(shareId: string, expiration: Date) {
    const result = await this.valkey.run((client) =>
      client.hSet(EXPIRATION_HASH, shareId, String(expiration.getTime())),
    );
    if (result !== undefined) return;

    await this.prisma.share
      .updateMany({ where: { id: shareId }, data: { expiration } })
      .catch((error) =>
        this.logger.warn(
          `Failed to persist expiration for share ${shareId}: ${error}`,
        ),
      );
  }

  async clear(shareId: string) {
    await this.valkey.run(async (client) => {
      await Promise.all([
        client.del(totalKey(shareId)),
        client.del(pendingKey(shareId)),
        client.sRem(VIEW_PENDING_SET, shareId),
        client.hDel(EXPIRATION_HASH, shareId),
      ]);
    });
  }

  async flush() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      await this.flushViews();
      await this.flushExpirations();
    } finally {
      this.flushing = false;
    }
  }

  async beforeApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  private async recordViewInDatabase(
    shareId: string,
    maxViews?: number | null,
  ): Promise<ViewResult> {
    try {
      const updated = await this.prisma.share.update({
        where: maxViews
          ? { id: shareId, views: { lt: maxViews } }
          : { id: shareId },
        data: { views: { increment: 1 } },
        select: { views: true },
      });
      return { status: "ok", views: updated.views };
    } catch (error) {
      if (
        error instanceof PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        const exists = await this.prisma.share.findUnique({
          where: { id: shareId },
          select: { id: true },
        });
        return {
          status: exists ? "limit" : "missing",
          views: 0,
        };
      }
      throw error;
    }
  }

  private async flushViews() {
    const pendingShares = await this.valkey.run((client) =>
      client.sMembers(VIEW_PENDING_SET),
    );
    if (!pendingShares?.length) return;

    for (const shareId of pendingShares) {
      const pending = await this.valkey.run((client) =>
        client.getSet(pendingKey(shareId), "0"),
      );
      if (pending === undefined) return;

      const count = Number(pending);
      if (!Number.isFinite(count) || count <= 0) {
        await this.valkey.run((client) =>
          client.sRem(VIEW_PENDING_SET, shareId),
        );
        continue;
      }

      try {
        const result = await this.prisma.share.updateMany({
          where: { id: shareId },
          data: { views: { increment: count } },
        });
        if (result.count === 0) {
          await this.clear(shareId);
          continue;
        }
      } catch (error) {
        this.logger.warn(
          `Failed to flush views for share ${shareId}: ${error}`,
        );
        await this.valkey.run((client) =>
          client.incrBy(pendingKey(shareId), count),
        );
        continue;
      }

      const remaining = await this.valkey.run((client) =>
        client.get(pendingKey(shareId)),
      );
      if (!remaining || Number(remaining) === 0) {
        await this.valkey.run((client) =>
          client.sRem(VIEW_PENDING_SET, shareId),
        );
      }
    }
  }

  private async flushExpirations() {
    const expirations = await this.valkey.run((client) =>
      client.hGetAll(EXPIRATION_HASH),
    );
    if (!expirations || Object.keys(expirations).length === 0) return;

    for (const [shareId, value] of Object.entries(expirations)) {
      const timestamp = Number(value);
      if (!Number.isFinite(timestamp)) {
        await this.valkey.run((client) =>
          client.hDel(EXPIRATION_HASH, shareId),
        );
        continue;
      }

      try {
        await this.prisma.share.updateMany({
          where: { id: shareId },
          data: { expiration: new Date(timestamp) },
        });
        await this.valkey.run((client) =>
          client.hDel(EXPIRATION_HASH, shareId),
        );
      } catch (error) {
        this.logger.warn(
          `Failed to flush expiration for share ${shareId}: ${error}`,
        );
      }
    }
  }
}

function totalKey(shareId: string) {
  return `${VIEW_TOTAL_PREFIX}${shareId}`;
}

function pendingKey(shareId: string) {
  return `${VIEW_PENDING_PREFIX}${shareId}`;
}
