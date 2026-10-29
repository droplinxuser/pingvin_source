import { lookup as dnsLookup } from "dns";
import { createWriteStream } from "fs";
import * as http from "http";
import * as https from "https";
import { isIP } from "net";
import { Transform } from "stream";
import { pipeline } from "stream/promises";
import { URL } from "url";

/**
 * Downloads a remote http(s) resource to a local file with SSRF protections:
 * only http/https on ports 80/443, DNS results are validated and pinned to a
 * public address, redirects are re-validated and capped, and the body is bounded
 * by size and time. The visitor's browser cannot fetch arbitrary hosts (CORS),
 * so the server performs the fetch instead, guarded here.
 */
export type RemoteFetchReason =
  | "invalid"
  | "blocked"
  | "too_large"
  | "too_many_redirects"
  | "timeout"
  | "http"
  | "network";

export class RemoteFetchError extends Error {
  constructor(
    public readonly reason: RemoteFetchReason,
    message?: string,
  ) {
    super(message ?? reason);
    this.name = "RemoteFetchError";
  }
}

export type RemoteDownloadResult = {
  size: number;
  contentType?: string;
  fileName?: string;
  finalUrl: string;
};

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
// URL.port is "" for the protocol default. Restricting the port blocks the
// server from being used to probe non-web services on a public host.
const ALLOWED_PORTS = new Set(["", "80", "443"]);
const MAX_REDIRECTS = 3;
const USER_AGENT = "PingvinShare/1.0 (remote-file-fetch)";

const BLOCKED_V4_RANGES = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
  "255.255.255.255/32",
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return (
    ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
  );
}

function inV4Range(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

function isBlockedIpv4(ip: string): boolean {
  return BLOCKED_V4_RANGES.some((range) => inV4Range(ip, range));
}

function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  if (lower === "::1" || lower === "::") return true;
  // fc00::/7 (unique local), fe80::/10 (link local), ff00::/8 (multicast),
  // 2001:db8::/32 (documentation), 2002::/16 (6to4) and 64:ff9b::/96 (NAT64).
  if (/^f[cd]/.test(lower)) return true;
  if (/^fe[89ab]/.test(lower)) return true;
  if (/^ff/.test(lower)) return true;
  if (lower.startsWith("2001:db8")) return true;
  if (lower.startsWith("2002")) return true;
  if (lower.startsWith("64:ff9b")) return true;
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isBlockedIpv4(ip);
  if (family === 6) return isBlockedIpv6(ip);
  return true;
}

// Rejects every private/internal address. Pinning the validated address here
// (rather than checking once and letting the socket resolve again) closes the
// DNS-rebinding window between the check and the connection.
function safeLookup(
  hostname: string,
  options: { all?: boolean; family?: number } | number,
  callback: (
    err: Error | null,
    address?: string | { address: string; family: number }[],
    family?: number,
  ) => void,
): void {
  const wantsAll = typeof options === "object" && options.all === true;
  const wantedFamily = typeof options === "number" ? options : options?.family;

  dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) {
      callback(err);
      return;
    }
    const safe = addresses.filter(
      (address) =>
        (!wantedFamily || address.family === wantedFamily) &&
        !isBlockedIp(address.address),
    );
    if (safe.length === 0) {
      callback(new RemoteFetchError("blocked"));
      return;
    }
    // Prefer IPv4 for broader compatibility when both families resolve.
    safe.sort(
      (a, b) => (a.family === 4 ? -1 : 0) - (b.family === 4 ? -1 : 0),
    );
    // Node passes `all: true` and then expects the full address list back.
    if (wantsAll) callback(null, safe);
    else callback(null, safe[0].address, safe[0].family);
  });
}

function parseContentDisposition(value?: string): string | undefined {
  if (!value) return undefined;
  const match = value.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function normalizeHostname(url: URL): string {
  const host = url.hostname;
  // IPv6 literals are wrapped in brackets in the URL host.
  return host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1)
    : host;
}

function validateUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RemoteFetchError("invalid");
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) throw new RemoteFetchError("blocked");
  if (!ALLOWED_PORTS.has(url.port)) throw new RemoteFetchError("blocked");
  const host = normalizeHostname(url);
  if (!host) throw new RemoteFetchError("invalid");
  // Node skips the custom `lookup` for IP-literal hosts, so check them here
  // (the WHATWG URL parser already normalizes numeric IPv4 forms like
  // http://2130706433/ to 127.0.0.1 before this point).
  if (isIP(host) && isBlockedIp(host)) throw new RemoteFetchError("blocked");
  // Embedded credentials are never needed and could be used to smuggle a host.
  if (url.username || url.password) throw new RemoteFetchError("blocked");
  return url;
}

type SingleRequestResult = {
  location?: string;
  size?: number;
  contentType?: string;
  fileName?: string;
};

function requestOnce(
  url: URL,
  destPath: string,
  options: {
    maxBytes?: number;
    timeoutMs: number;
    connectTimeoutMs: number;
  },
): Promise<SingleRequestResult> {
  return new Promise<SingleRequestResult>((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    let settled = false;
    // Assigned once after the request is created; kept `let` so `finish` can
    // clear it even though it is defined first.
    // eslint-disable-next-line prefer-const
    let overallTimer: NodeJS.Timeout | undefined;

    const finish =
      (fn: (value: never) => void) =>
      (value: unknown) => {
        if (settled) return;
        settled = true;
        if (overallTimer) clearTimeout(overallTimer);
        fn(value as never);
      };
    const ok = finish(resolve as (value: never) => void);
    const fail = finish(reject as (value: never) => void);

    const requestOptions = {
      method: "GET",
      headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
      // Node's LookupFunction has overloads TypeScript does not infer here.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lookup: safeLookup as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const req = lib.request(url, requestOptions, (res) => {
      const status = res.statusCode ?? 0;

      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        ok({ location: res.headers.location });
        return;
      }
      if (status !== 200) {
        res.resume();
        fail(new RemoteFetchError("http", `HTTP ${status}`));
        return;
      }

      const contentLength = Number(res.headers["content-length"]);
      if (
        options.maxBytes &&
        Number.isFinite(contentLength) &&
        contentLength > options.maxBytes
      ) {
        res.destroy();
        fail(new RemoteFetchError("too_large"));
        return;
      }

      let received = 0;
      // Count and cap inside the stream instead of adding a `data` listener,
      // which would conflict with pipeline's flowing-mode management.
      const limiter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          received += chunk.length;
          if (options.maxBytes && received > options.maxBytes) {
            callback(new RemoteFetchError("too_large"));
            return;
          }
          callback(null, chunk);
        },
      });

      const out = createWriteStream(destPath);
      pipeline(res, limiter, out)
        .then(() => {
          if (settled) return;
          ok({
            size: received,
            contentType: res.headers["content-type"],
            fileName: parseContentDisposition(
              res.headers["content-disposition"],
            ),
          });
        })
        .catch((error) => fail(error));
    });

    overallTimer = setTimeout(
      () => req.destroy(new RemoteFetchError("timeout")),
      options.timeoutMs,
    );
    req.setTimeout(options.connectTimeoutMs, () =>
      req.destroy(new RemoteFetchError("timeout")),
    );
    req.on("error", (error) => fail(error));
    req.end();
  });
}

export async function downloadRemoteToFile(
  rawUrl: string,
  destPath: string,
  options: {
    maxBytes?: number;
    timeoutMs?: number;
    connectTimeoutMs?: number;
  } = {},
): Promise<RemoteDownloadResult> {
  let url = validateUrl(rawUrl);
  const resolved = {
    maxBytes: options.maxBytes,
    timeoutMs: options.timeoutMs ?? 5 * 60 * 1000,
    connectTimeoutMs: options.connectTimeoutMs ?? 15 * 1000,
  };

  for (let redirects = 0; ; redirects++) {
    const result = await requestOnce(url, destPath, resolved);
    if (result.location !== undefined) {
      if (redirects >= MAX_REDIRECTS)
        throw new RemoteFetchError("too_many_redirects");
      let next: URL;
      try {
        next = new URL(result.location, url);
      } catch {
        throw new RemoteFetchError("invalid");
      }
      url = validateUrl(next.toString());
      continue;
    }

    return {
      size: result.size ?? 0,
      contentType: result.contentType,
      fileName: result.fileName,
      finalUrl: url.toString(),
    };
  }
}
