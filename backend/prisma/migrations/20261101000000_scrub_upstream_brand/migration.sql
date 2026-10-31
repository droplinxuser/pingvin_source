-- Remove the upstream product name from stored configuration values and
-- defaults. This covers email subjects/bodies, legal text and the app-name
-- fallback on databases created before the neutral defaults were introduced.
UPDATE "Config" SET "value" = REPLACE("value", 'Pingvin Share X', 'File Share');
UPDATE "Config" SET "value" = REPLACE("value", 'Pingvin Share', 'File Share');
UPDATE "Config" SET "value" = REPLACE("value", 'Pingvin', 'File Share');
UPDATE "Config" SET "defaultValue" = REPLACE("defaultValue", 'Pingvin Share X', 'File Share');
UPDATE "Config" SET "defaultValue" = REPLACE("defaultValue", 'Pingvin Share', 'File Share');
UPDATE "Config" SET "defaultValue" = REPLACE("defaultValue", 'Pingvin', 'File Share');

-- The penguin was part of the old signature; drop it from the same templates.
UPDATE "Config" SET "value" = REPLACE("value", ' 🐧', '');
UPDATE "Config" SET "defaultValue" = REPLACE("defaultValue", ' 🐧', '');

-- The old sample Redis hostname is also shown as a default in the admin UI.
UPDATE "Config" SET "defaultValue" = REPLACE("defaultValue", 'redis://pingvin-redis:6379', 'redis://file-share-redis:6379');
