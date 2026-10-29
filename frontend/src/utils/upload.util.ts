import type { AxiosProgressEvent } from "axios";

const UPLOAD_INACTIVITY_TIMEOUT_MS = 60_000;

export type UploadProgressHandler = (progressEvent: AxiosProgressEvent) => void;

/**
 * Downloads a remote file in the visitor's own browser and returns it as a
 * `File`, so it can be uploaded through the normal chunked path. Running the
 * fetch in the browser means the remote host only ever sees the visitor's IP,
 * never the server's. Anything the browser cannot read cross-origin (a CORS
 * failure) rejects here; supported file hosts are handled by the backend
 * resolver instead.
 */
export const fetchRemoteAsFile = async (
  url: string,
  fallbackName: string,
): Promise<File> => {
  const response = await fetch(url, {
    mode: "cors",
    credentials: "omit",
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  const name = nameFromHeaders(response.headers) || fallbackName;
  return new File([blob], sanitizeName(name), {
    type: response.headers.get("content-type") || blob.type || undefined,
  });
};

// Keeps the name safe for the backend's upload validation (no path segments or
// control characters).
const sanitizeName = (name: string): string => {
  const base = (name.split(/[\\/]/).pop() ?? "").trim();
  // eslint-disable-next-line no-control-regex
  const trimmed = base.replace(/[\u0000-\u001f\u007f]/g, "");
  return (trimmed || "download").slice(0, 1024);
};

const nameFromHeaders = (headers: Headers): string | undefined => {
  const disposition = headers.get("content-disposition");
  if (!disposition) return undefined;
  const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
};

type UploadRequest<T> = (
  signal: AbortSignal,
  onUploadProgress: UploadProgressHandler,
) => Promise<T>;

export const withUploadInactivityTimeout = async <T>(
  request: UploadRequest<T>,
  onUploadProgress?: UploadProgressHandler,
  externalSignal?: AbortSignal,
): Promise<T> => {
  const controller = new AbortController();
  let inactivityTimeout: ReturnType<typeof setTimeout> | undefined;

  const resetInactivityTimeout = () => {
    clearTimeout(inactivityTimeout);
    inactivityTimeout = setTimeout(
      () => controller.abort(),
      UPLOAD_INACTIVITY_TIMEOUT_MS,
    );
  };

  // A caller (the upload list) can abort the whole request, e.g. when the user
  // cancels an in-progress file.
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }

  resetInactivityTimeout();

  try {
    return await request(controller.signal, (progressEvent) => {
      resetInactivityTimeout();
      onUploadProgress?.(progressEvent);
    });
  } finally {
    clearTimeout(inactivityTimeout);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
};
