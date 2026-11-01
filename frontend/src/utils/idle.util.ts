/**
 * Runs a third-party loader after the browser is idle. The timeout keeps a
 * busy page from postponing analytics/ads forever.
 */
export function scheduleIdle(
  callback: () => void,
  timeout = 2000,
): () => void {
  if (typeof window === "undefined") return () => {};
  let idleHandle: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  if ("requestIdleCallback" in window) {
    idleHandle = window.requestIdleCallback(callback, { timeout });
  } else {
    timer = setTimeout(callback, 800);
  }

  return () => {
    if (idleHandle !== undefined) window.cancelIdleCallback(idleHandle);
    if (timer) clearTimeout(timer);
  };
}

/**
 * Defers a third-party script until the document's own `load` event and then
 * an idle slice. Returns a cleanup that removes both the listener and the
 * pending idle callback, so a route change never starts a loader afterwards.
 */
export function scheduleAfterLoad(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  let cancelIdle: (() => void) | undefined;
  const start = () => {
    cancelIdle = scheduleIdle(callback);
  };

  if (document.readyState === "complete") {
    start();
    return () => cancelIdle?.();
  }

  const onLoad = () => {
    window.removeEventListener("load", onLoad);
    start();
  };
  window.addEventListener("load", onLoad, { once: true });

  return () => {
    window.removeEventListener("load", onLoad);
    cancelIdle?.();
  };
}
