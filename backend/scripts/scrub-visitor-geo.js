// Remove legacy visitor location detail (city, region, timezone) from the
// per-share uploader.json files and the VirusTotal audit state. Country stays.
// Runs while the backend is stopped, before the new build starts, and never
// fails a deployment: a malformed file is skipped and reported.
const fs = require("fs");
const path = require("path");

const DATA_DIRECTORY = process.env.DATA_DIRECTORY || "./data";
const LEGACY_FIELDS = ["city", "region", "timezone"];

function dropLegacyFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  let changed = false;
  for (const field of LEGACY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, field)) {
      delete value[field];
      changed = true;
    }
  }
  return changed;
}

function writeAtomic(file, value) {
  const temporary = `${file}.scrub-${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function scrubJsonFile(file, scrub) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return false;
  }
  if (!scrub(value)) return false;
  writeAtomic(file, value);
  return true;
}

function scrubUploaderInfo(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  let changed = dropLegacyFields(value);
  if (Array.isArray(value.visitors)) {
    for (const visitor of value.visitors) {
      if (dropLegacyFields(visitor)) changed = true;
    }
  }
  return changed;
}

function scrubVirusTotalState(value) {
  if (!Array.isArray(value?.events)) return false;
  let changed = false;
  for (const event of value.events) {
    if (dropLegacyFields(event?.uploader)) changed = true;
  }
  return changed;
}

function countScrubbedUploaders() {
  const sharesDirectory = path.join(DATA_DIRECTORY, "uploads", "shares");
  let entries;
  try {
    entries = fs.readdirSync(sharesDirectory, { withFileTypes: true });
  } catch {
    return 0;
  }

  let scrubbed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(sharesDirectory, entry.name, "uploader.json");
    try {
      if (scrubJsonFile(file, scrubUploaderInfo)) scrubbed++;
    } catch (error) {
      console.warn(`Could not scrub ${file}: ${error.message}`);
    }
  }
  return scrubbed;
}

function countScrubbedVirusTotal() {
  const file = path.join(DATA_DIRECTORY, "virustotal", "state.json");
  try {
    return scrubJsonFile(file, scrubVirusTotalState) ? 1 : 0;
  } catch (error) {
    console.warn(`Could not scrub ${file}: ${error.message}`);
    return 0;
  }
}

try {
  const uploaders = countScrubbedUploaders();
  const virusTotal = countScrubbedVirusTotal();
  console.log(
    `Removed legacy visitor location fields from ${uploaders} uploader file(s)` +
      (virusTotal ? " and the VirusTotal state" : ""),
  );
} catch (error) {
  console.warn(`Visitor location scrub skipped: ${error.message}`);
}
