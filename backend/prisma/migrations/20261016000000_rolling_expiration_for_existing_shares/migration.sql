-- Rolling expiration rollout
--
-- Give every existing share a fresh expiration of 100 days from the deploy
-- time of this migration (expiration is automatic and immutable from now on).
-- Visiting a share page resets its expiration to 100 days from each visit
-- (handled by the application), so untouched shares expire ~100 days after
-- this update is deployed.

UPDATE "Share"
SET "expiration" = datetime('now', '+100 days');
