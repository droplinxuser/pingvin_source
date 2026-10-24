-- Indexes used by sitemap generation, account/admin share lists and relation
-- lookups. SQLite does not create foreign-key indexes automatically, so these
-- avoid full table scans on large installs.
CREATE INDEX IF NOT EXISTS "Share_uploadLocked_createdAt_idx" ON "Share"("uploadLocked", "createdAt");
CREATE INDEX IF NOT EXISTS "Share_expiration_idx" ON "Share"("expiration");
CREATE INDEX IF NOT EXISTS "Share_creatorId_idx" ON "Share"("creatorId");
CREATE INDEX IF NOT EXISTS "Share_reverseShareId_idx" ON "Share"("reverseShareId");
CREATE INDEX IF NOT EXISTS "File_shareId_idx" ON "File"("shareId");
CREATE INDEX IF NOT EXISTS "ShareRecipient_shareId_idx" ON "ShareRecipient"("shareId");
