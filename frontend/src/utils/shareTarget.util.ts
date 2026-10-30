const CACHE_NAME = "dropmb-shared-files-v1";
const PREFIX = "/__shared/";

export type SharedTargetPayload = {
  title?: string;
  text?: string;
  url?: string;
  files: File[];
};

const key = (id: string, part: string) =>
  `${window.location.origin}${PREFIX}${id}/${part}`;

/**
 * Reads a payload stored by the service worker for the PWA share target.
 * The browser's Share Target API posts files to the service worker; the worker
 * keeps them in Cache Storage until this page picks them up.
 */
export async function takeSharedTargetPayload(
  id: string,
): Promise<SharedTargetPayload | null> {
  if (typeof caches === "undefined") return null;

  const cache = await caches.open(CACHE_NAME);
  const metaResponse = await cache.match(key(id, "meta"));
  if (!metaResponse) return null;

  const meta = (await metaResponse.json()) as {
    title?: string;
    text?: string;
    url?: string;
    files?: {
      index: number;
      name: string;
      type?: string;
      lastModified?: number;
    }[];
  };

  const files: File[] = [];
  for (const entry of meta.files ?? []) {
    const response = await cache.match(key(id, String(entry.index)));
    if (!response) continue;
    const blob = await response.blob();
    files.push(
      new File([blob], entry.name, {
        type: entry.type || blob.type || "application/octet-stream",
        lastModified: entry.lastModified || Date.now(),
      }),
    );
    await cache.delete(key(id, String(entry.index)));
  }
  await cache.delete(key(id, "meta"));

  return {
    title: meta.title,
    text: meta.text,
    url: meta.url,
    files,
  };
}
