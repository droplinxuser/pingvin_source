-- Optional per-share download cap. The counter is durable and incremented
-- atomically only for real download requests; the rolling Valkey stats remain
-- the display-only counters.
ALTER TABLE "ShareSecurity" ADD COLUMN "maxDownloads" INTEGER;
ALTER TABLE "ShareSecurity" ADD COLUMN "downloadCount" INTEGER NOT NULL DEFAULT 0;
