/* eslint-env serviceworker */
// Custom Workbox service-worker additions. next-pwa imports this file into the
// generated worker, so it must stay dependency-free.
const SHARED_CACHE = "pingvin-shared-files-v1";
const SHARED_PREFIX = "/__shared/";
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024 * 1024;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const sharedKey = (id, part) =>
  `${self.location.origin}${SHARED_PREFIX}${id}/${part}`;

const randomId = () =>
  self.crypto?.randomUUID?.() ||
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

async function cleanupOldPayloads(cache) {
  try {
    const keys = await cache.keys();
    const now = Date.now();
    for (const request of keys) {
      if (!request.url.includes(`${SHARED_PREFIX}`)) continue;
      if (!request.url.endsWith("/meta")) continue;
      const response = await cache.match(request);
      if (!response) continue;
      const meta = await response.json().catch(() => undefined);
      if (!meta || now - Number(meta.createdAt || 0) < MAX_AGE_MS) continue;
      const base = request.url.slice(0, -"meta".length);
      await cache.delete(request);
      for (const entry of meta.files || []) {
        await cache.delete(`${base}${entry.index}`);
      }
    }
  } catch {
    // Cleanup is best-effort; stale entries will be overwritten/deleted later.
  }
}

async function handleShareTarget(request) {
  try {
    const form = await request.formData();
    const files = form
      .getAll("files")
      .filter(
        (value) =>
          typeof value !== "string" &&
          typeof value?.arrayBuffer === "function" &&
          value.size > 0,
      );

    if (files.length === 0) {
      return Response.redirect(new URL("/upload?shared=empty", self.location.origin).toString(), 303);
    }
    if (
      files.some((file) => file.size > MAX_FILE_BYTES) ||
      files.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_BYTES
    ) {
      return Response.redirect(new URL("/upload?shared=error", self.location.origin).toString(), 303);
    }

    const cache = await caches.open(SHARED_CACHE);
    await cleanupOldPayloads(cache);
    const id = randomId();
    const entries = [];
    for (const [index, file] of files.entries()) {
      await cache.put(
        sharedKey(id, String(index)),
        new Response(file, {
          headers: {
            "Content-Type": file.type || "application/octet-stream",
          },
        }),
      );
      entries.push({
        index,
        name: file.name || `shared-file-${index + 1}`,
        type: file.type,
        lastModified: file.lastModified,
      });
    }
    await cache.put(
      sharedKey(id, "meta"),
      new Response(
        JSON.stringify({
          createdAt: Date.now(),
          title: form.get("title") || undefined,
          text: form.get("text") || undefined,
          url: form.get("url") || undefined,
          files: entries,
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );

    return Response.redirect(new URL(`/upload?shared=${encodeURIComponent(id)}`, self.location.origin).toString(), 303);
  } catch {
    return Response.redirect(new URL("/upload?shared=error", self.location.origin).toString(), 303);
  }
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method === "POST" &&
    url.origin === self.location.origin &&
    url.pathname === "/share-target"
  ) {
    event.respondWith(handleShareTarget(event.request));
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .open(SHARED_CACHE)
      .then((cache) => cleanupOldPayloads(cache))
      .catch(() => {}),
  );
});
