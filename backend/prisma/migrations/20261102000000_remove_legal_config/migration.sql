-- The built-in imprint/privacy documents replaced the admin-owned legal
-- settings. The rows are inert (no code reads them) and their legacy markdown
-- was still returned by the public config endpoint on old installs, so remove
-- them. The config seed no longer creates them either.
DELETE FROM "Config" WHERE "category" = 'legal';
