-- Raise the site-wide share limit from the legacy 512 MB cap to 5 GB.
-- The per-file cap is added by the config seed (`share.maxFileSize`), so only
-- the existing value needs a one-time update. Fresh installs already receive
-- the new defaults from the seed.
UPDATE "Config"
SET "value" = '5000000000',
    "defaultValue" = '5000000000'
WHERE "category" = 'share'
  AND "name" = 'maxSize'
  AND ("value" = '512000000' OR "value" = '536870912');

-- Reverse-share and per-user limits that were pinned to the old global cap
-- move to the new cap as well. Any other custom value stays untouched.
UPDATE "ReverseShare"
SET "maxShareSize" = '5000000000'
WHERE "maxShareSize" IN ('512000000', '536870912');

UPDATE "User"
SET "shareSizeLimit" = '5000000000'
WHERE "shareSizeLimit" IN ('512000000', '536870912');

-- Keep the operator-provided legal copy in sync with the new limits. Only
-- exact legacy sentences are replaced, so custom wording stays untouched.
UPDATE "Config"
SET "value" = replace(
  replace(
    replace(
      replace(
        "value",
        'A single share can contain up to **512 MB** in total, across any file type.',
        'A single share can contain up to **5 GB** in total, and each file can be up to **512 MB**.'
      ),
      'download multi-file shares as a ZIP archive.',
      'download every file in a multi-file share individually.'
    ),
    '- **Maximum share size:** 512 MB per share, including all files in that share.',
    '- **Maximum share size:** 5 GB per share, including all files in that share.' || char(10) ||
    '- **Maximum file size:** 512 MB per file.' || char(10) ||
    '- Files are downloaded individually, so each download stays fast and cacheable.'
  ),
  '**Last updated: October 22, 2026**',
  '**Last updated: October 25, 2026**'
)
WHERE "category" = 'legal'
  AND "name" = 'imprintText';
