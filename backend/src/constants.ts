import { LogLevel } from "@nestjs/common";

// Load .env files (backend/.env first, then the repository root .env) before
// reading any values below. Existing environment variables win.
for (const file of [".env", "../.env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // File not present, ignore
  }
}

export const CONFIG_FILE = process.env.CONFIG_FILE || "../config.yaml";

export const DATA_DIRECTORY = process.env.DATA_DIRECTORY || "./data";
export const SHARE_DIRECTORY = `${DATA_DIRECTORY}/uploads/shares`;
export const AVATAR_DIRECTORY = `${DATA_DIRECTORY}/avatars`;
export const DATABASE_URL =
  process.env.DATABASE_URL ||
  "file:../data/pingvin-share.db?connection_limit=1";
export const CLAMAV_HOST =
  process.env.CLAMAV_HOST ||
  (process.env.NODE_ENV == "docker" ? "clamav" : "127.0.0.1");
export const CLAMAV_PORT = parseInt(process.env.CLAMAV_PORT) || 3310;

export const LOG_LEVEL_AVAILABLE: LogLevel[] = ['verbose', 'debug', 'log', 'warn', 'error', 'fatal'];
export const LOG_LEVEL_DEFAULT: LogLevel = process.env.NODE_ENV === 'development' ? "verbose" : "log";
export const LOG_LEVEL_ENV = `${process.env.PV_LOG_LEVEL || ""}`;