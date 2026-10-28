-- Fork-only index tuning.
--
-- Share.reverseShareId is NULL for every normal upload and creatorId is NULL
-- for anonymous uploads. SQLite stores those NULLs in a full index, so both
-- indexes are mostly empty key entries. Partial indexes keep equality lookups
-- fast while storing only the rows that can actually match.
DROP INDEX IF EXISTS "Share_creatorId_idx";
CREATE INDEX "Share_creatorId_idx"
  ON "Share"("creatorId")
  WHERE "creatorId" IS NOT NULL;

DROP INDEX IF EXISTS "Share_reverseShareId_idx";
CREATE INDEX "Share_reverseShareId_idx"
  ON "Share"("reverseShareId")
  WHERE "reverseShareId" IS NOT NULL;
