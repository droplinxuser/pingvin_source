-- Relation lookups that previously scanned the table: the share guard loads
-- user recipients by share, and the reverse-share list/cleanup filters by
-- creator and expiration. SQLite does not index foreign keys automatically.
CREATE INDEX IF NOT EXISTS "ShareUserRecipient_shareId_idx" ON "ShareUserRecipient"("shareId");
CREATE INDEX IF NOT EXISTS "ReverseShare_creatorId_idx" ON "ReverseShare"("creatorId");
CREATE INDEX IF NOT EXISTS "ReverseShare_shareExpiration_idx" ON "ReverseShare"("shareExpiration");
