const ENDPOINT = "/api/logs/client";
const DEDUPE_MS = 15_000;
const MAX_SEEN = 50;
const INSTALL_FLAG = "__pingvinErrorReporterInstalled";

type ClientErrorPayload = {
  message: string;
  stack?: string;
  context: string;
  url: string;
};

const seen = new Map<string, number>();

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength ? value.slice(0, maxLength) : value;

const isBlockedAutoplay = (reason: unknown): boolean => {
  if (!reason || typeof reason !== "object") return false;
  const { name, message } = reason as {
    name?: unknown;
    message?: unknown;
  };
  return (
    name === "NotAllowedError" &&
    typeof message === "string" &&
    /play\(\)/i.test(message)
  );
};

const stringifyReason = (reason: unknown): string => {
  if (reason instanceof Error) return `${reason.name}: ${reason.message}`;
  if (typeof reason === "string") return reason;
  try {
    return JSON.stringify(reason) ?? String(reason);
  } catch {
    return String(reason);
  }
};

const report = (payload: ClientErrorPayload) => {
  const key = `${payload.url}\n${payload.context}\n${payload.message}\n${payload.stack ?? ""}`;
  const now = Date.now();
  const last = seen.get(key);
  if (last !== undefined && now - last < DEDUPE_MS) return;

  if (seen.size >= MAX_SEEN) seen.clear();
  seen.set(key, now);

  try {
    // Errors must never break the page or produce another console entry.
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        message: truncate(payload.message, 4_000),
        stack: payload.stack && truncate(payload.stack, 12_000),
        url: truncate(payload.url, 1_000),
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Ignore unsupported fetch/keepalive environments.
  }
};

/**
 * Reports uncaught browser errors to the backend so administrators can read
 * backend and frontend errors from one place. It intentionally does not wrap
 * console.error, which would capture handled errors and generate noise.
 */
export function installGlobalErrorReporter() {
  if (typeof window === "undefined") return;
  const flagged = window as unknown as Record<string, boolean>;
  if (flagged[INSTALL_FLAG]) return;
  flagged[INSTALL_FLAG] = true;

  // Query strings can carry recipient tokens and the origin is not needed for
  // diagnostics, so only the public route path is stored.
  const pageUrl = () => window.location.pathname;

  window.addEventListener("error", (event) => {
    if (!event.message || event.message === "Script error.") return;
    const error = event.error instanceof Error ? event.error : undefined;
    report({
      message: error ? `${error.name}: ${error.message}` : event.message,
      stack: error?.stack,
      context: "window.onerror",
      url: pageUrl(),
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;

    // Third-party ad creatives sometimes call video.play() before a user
    // gesture. The rejection is expected Chrome autoplay policy noise, not an
    // application fault, and would otherwise clutter the console and log store.
    if (isBlockedAutoplay(reason)) {
      event.preventDefault();
      return;
    }

    report({
      message: stringifyReason(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
      context: "unhandledrejection",
      url: pageUrl(),
    });
  });
}
