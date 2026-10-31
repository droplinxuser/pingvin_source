import type { AxiosProgressEvent } from "axios";

const UPLOAD_INACTIVITY_TIMEOUT_MS = 60_000;

export type UploadProgressHandler = (progressEvent: AxiosProgressEvent) => void;

/** The fetched URL served a web page (or XHTML) instead of a file. */
export class RemoteNotAFileError extends Error {
  constructor() {
    super("remote response is not a file");
    this.name = "RemoteNotAFileError";
  }
}

/** The remote file is larger than the instance's per-file upload limit. */
export class RemoteFileTooLargeError extends Error {
  constructor() {
    super("remote file is too large");
    this.name = "RemoteFileTooLargeError";
  }
}

/**
 * Reads the response body with a hard byte cap. `response.blob()` would buffer
 * an arbitrarily large (or endless) stream in the tab before Dropzone gets a
 * chance to reject it.
 */
const readBodyWithLimit = async (
  response: Response,
  maxBytes: number,
): Promise<Blob> => {
  const contentType = response.headers.get("content-type") || "";
  if (!response.body) {
    const blob = await response.blob();
    if (maxBytes > 0 && blob.size > maxBytes)
      throw new RemoteFileTooLargeError();
    return blob;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (maxBytes > 0 && received > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RemoteFileTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  // Let Blob concatenate the chunks itself. Copying them into one additional
  // buffer first doubled peak memory for a large remote file.
  return new Blob(chunks as ConstructorParameters<typeof Blob>[0], {
    type: contentType || undefined,
  });
};

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
  maxBytes = 0,
): Promise<File> => {
  const response = await fetch(url, {
    mode: "cors",
    credentials: "omit",
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const contentType = (
    response.headers.get("content-type") || ""
  ).toLowerCase();
  // A landing page is not the file. Reject it so the UI can suggest a direct
  // link instead of uploading the page's HTML as the "file".
  if (
    contentType.includes("text/html") ||
    contentType.includes("application/xhtml")
  )
    throw new RemoteNotAFileError();

  const declaredLength = Number(response.headers.get("content-length"));
  if (
    maxBytes > 0 &&
    Number.isFinite(declaredLength) &&
    declaredLength > maxBytes
  )
    throw new RemoteFileTooLargeError();

  const blob = await readBodyWithLimit(response, maxBytes);
  const name =
    nameFromHeaders(response.headers) || nameFromUrl(url) || fallbackName;
  return new File([blob], sanitizeName(name), {
    type: contentType || blob.type || undefined,
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
  if (disposition) {
    const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i);
    if (match) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    }
  }
  // Some download endpoints expose the name in a custom header instead.
  for (const header of ["x-filename", "x-original-filename", "x-file-name"]) {
    const value = headers.get(header);
    if (value) return value;
  }
  return undefined;
};

const nameFromUrl = (raw: string): string | undefined => {
  try {
    const segment = new URL(raw).pathname.split("/").filter(Boolean).pop();
    if (!segment) return undefined;
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  } catch {
    return undefined;
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
