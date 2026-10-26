import { Progress } from "@mantine/core";
import { useRouter } from "next/router";
import { useCallback, useEffect, useRef, useState } from "react";
import useTranslate from "../../hooks/useTranslate.hook";

// Keep the bar on screen long enough to be noticed on a cached/fast route,
// then fade it out immediately after the new page is ready.
const MIN_VISIBLE_MS = 200;
const FADE_OUT_MS = 150;

/**
 * A slim fixed progress bar for client-side navigations. Next may resolve a
 * prefetched route in a few milliseconds; the minimum visible time makes the
 * loading state perceptible without delaying the navigation itself.
 */
const RouteProgress = () => {
  const router = useRouter();
  const t = useTranslate();
  const [active, setActive] = useState(false);
  const [progress, setProgress] = useState(0);
  const startedAt = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();

  const clearHideTimer = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = undefined;
    }
  };

  const start = useCallback(() => {
    clearHideTimer();
    startedAt.current = Date.now();
    setActive(true);
    setProgress(25);
  }, []);

  const finish = useCallback(() => {
    if (!startedAt.current) return;

    const remaining = Math.max(
      0,
      MIN_VISIBLE_MS - (Date.now() - startedAt.current),
    );
    clearHideTimer();
    hideTimer.current = setTimeout(() => {
      setProgress(100);
      hideTimer.current = setTimeout(() => {
        setActive(false);
        setProgress(0);
        startedAt.current = 0;
      }, FADE_OUT_MS);
    }, remaining);
  }, []);

  useEffect(() => {
    router.events.on("routeChangeStart", start);
    router.events.on("routeChangeComplete", finish);
    router.events.on("routeChangeError", finish);
    router.events.on("hashChangeStart", start);
    router.events.on("hashChangeComplete", finish);

    return () => {
      router.events.off("routeChangeStart", start);
      router.events.off("routeChangeComplete", finish);
      router.events.off("routeChangeError", finish);
      router.events.off("hashChangeStart", start);
      router.events.off("hashChangeComplete", finish);
      clearHideTimer();
    };
  }, [finish, router.events, start]);

  useEffect(() => {
    if (!active) return;

    const timers = [
      setTimeout(() => setProgress(60), 300),
      setTimeout(() => setProgress(80), 900),
      setTimeout(() => setProgress(90), 2_000),
    ];

    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [active]);

  return (
    <Progress
      value={progress}
      size={3}
      radius={0}
      striped={active}
      animate={active}
      role="progressbar"
      aria-label={t("common.custom.loading")}
      sx={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        opacity: active ? 1 : 0,
        pointerEvents: "none",
        transition: `opacity ${FADE_OUT_MS}ms ease`,
      }}
    />
  );
};

export default RouteProgress;
