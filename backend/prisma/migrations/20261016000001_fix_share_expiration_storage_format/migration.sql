-- Fix the storage format of the expiration values written by the previous
-- migration (20261016000000_rolling_expiration_for_existing_shares).
--
-- That migration used datetime('now','+100 days'), which stores a TEXT value,
-- while Prisma's SQLite connector stores DateTime as INTEGER milliseconds
-- since the Unix epoch. Because SQLite sorts TEXT above INTEGER, the text
-- rows broke "ORDER BY expiration" (old rows always sorted above newly
-- uploaded ones) and all DB-side date comparisons against those rows.
--
-- Convert the TEXT values back to INTEGER milliseconds while preserving the
-- exact same timestamp (deploy time + 100 days).

UPDATE "Share"
SET "expiration" = CAST(strftime('%s', "expiration") AS INTEGER) * 1000
WHERE typeof("expiration") = 'text';
