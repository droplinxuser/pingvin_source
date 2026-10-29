import { spawn } from "child_process";
import * as net from "net";

/**
 * Small, side-effect-free probes for the external tools the backend shells out
 * to. They are used by the admin "server dependencies" panel so a misconfigured
 * or freshly transferred server is easy to spot (missing ffmpeg, yt-dlp,
 * ClamAV, ...). Every probe is bounded and never throws.
 */
export type DependencyType = "required" | "optional";

export type DependencyCheck = {
  key: string;
  type: DependencyType;
  available: boolean;
  // For optional features: whether the feature is turned on at all. An
  // unavailable dependency that is simply switched off is not an error.
  enabled?: boolean;
  version?: string;
  detail?: string;
};

export type BinaryProbe = {
  available: boolean;
  version?: string;
  detail?: string;
};

const MAX_OUTPUT_BYTES = 4096;

/**
 * Runs a binary and reports whether it exists and which version it prints.
 * A missing binary, a non-zero exit or a timeout all resolve to
 * `{ available: false }` instead of rejecting.
 */
export function checkBinary(
  command: string,
  args: string[] = ["--version"],
  timeoutMs = 5000,
): Promise<BinaryProbe> {
  return new Promise<BinaryProbe>((resolve) => {
    let output = "";
    let settled = false;
    const done = (value: BinaryProbe) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let child;
    try {
      child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      done({ available: false, detail: (error as Error).message });
      return;
    }

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done({ available: false, detail: "timed out" });
    }, timeoutMs);

    const collect = (chunk: Buffer) => {
      if (output.length < MAX_OUTPUT_BYTES) output += chunk.toString();
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);

    child.on("error", (error) => {
      clearTimeout(timer);
      done({ available: false, detail: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        done({ available: false, detail: `exit code ${code}` });
        return;
      }
      done({ available: true, version: extractVersion(output) });
    });
  });
}

/** Pulls the version token out of a tool's version output. */
export function extractVersion(output: string): string | undefined {
  const firstLine = output.split("\n").find((line) => line.trim());
  if (!firstLine) return undefined;
  // "ffmpeg version 6.1.1 ...", "yt-dlp 2026.08.19" or a bare "2026.08.19".
  const named = firstLine.match(/version\s+v?([\w.+-]+)/i);
  if (named) return named[1];
  const bare = firstLine.match(/v?(\d[\w.+-]*)/);
  return bare?.[1];
}

/** TCP connect probe (used for the optional ClamAV daemon). */
export function checkTcp(
  host: string,
  port: number,
  timeoutMs = 1500,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      done(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      done(false);
    });
  });
}

let ffmpegCandidates: string[] | undefined;

/**
 * The ffmpeg binaries to try, in order: the FFMPEG_PATH override, the optional
 * `ffmpeg-static` package, then `ffmpeg` on PATH. Shared by the thumbnail
 * builder and the dependency panel so the two cannot drift.
 */
export function getFfmpegCandidates(): string[] {
  if (ffmpegCandidates) return ffmpegCandidates;

  const candidates: string[] = [];
  if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);

  try {
    // The static binary is optional so a minimal install can still run; in
    // that case the system `ffmpeg` on PATH is used instead.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const staticBinary = require("ffmpeg-static") as string | undefined;
    if (staticBinary) candidates.push(staticBinary);
  } catch {
    // Optional dependency not installed.
  }

  candidates.push("ffmpeg");
  ffmpegCandidates = candidates;
  return candidates;
}
