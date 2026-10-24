import { Box, Card, Text } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import useTranslate from "../hooks/useTranslate.hook";

// Ad units from the publishers' original snippets. Banner scripts are inserted
// into the placeholder below, page-level scripts into <body>.
const SCRIPTS = [
  { src: "//iz.chaponrearing.com/t9EmdEo0Xr3P/157480", banner: true },
  { src: "https://grop.net/14/4d696fd2a6a11010f9f9e4cdbadc5907" },
  { src: "https://wingsmob.com/1/ccdff92c9d7f97c5af143f6c519f16ed" },
];

const Ads = ({ gallery = false }: { gallery?: boolean }) => {
  const bannerRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const t = useTranslate();

  useEffect(() => {
    let cancelled = false;
    let idleHandle: number | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let observer: MutationObserver | undefined;
    let scripts: HTMLScriptElement[] = [];
    setCollapsed(false);

    const hasAdContent = () => {
      const banner = bannerRef.current;
      if (!banner) return false;

      // Ad networks normally inject an iframe/image/canvas. Check for those
      // first, including while the placeholder itself is collapsed.
      if (banner.querySelector("iframe, img, video, canvas, object, embed"))
        return true;
      if (banner.innerText.trim()) return true;

      // Some networks inject a styled wrapper without media elements. Only
      // count wrappers that actually occupy space.
      return Array.from(banner.querySelectorAll("div, ins")).some((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    };

    const load = () => {
      if (cancelled) return;
      scripts = SCRIPTS.map(({ src, banner }) => {
        const script = document.createElement("script");
        script.setAttribute("data-cfasync", "false");
        script.async = !!banner;
        script.src = src;
        (banner ? bannerRef.current : document.body)?.appendChild(script);
        return script;
      });
    };

    // If no ad fills the slot after the first paint, remove the reserved
    // space. A MutationObserver brings the slot back if an ad arrives later.
    settleTimer = setTimeout(() => {
      if (!cancelled) setCollapsed(!hasAdContent());
    }, 5000);

    if (typeof MutationObserver !== "undefined" && bannerRef.current) {
      observer = new MutationObserver(() => {
        if (!cancelled && hasAdContent()) setCollapsed(false);
      });
      observer.observe(bannerRef.current, { childList: true, subtree: true });
    }

    // Third-party tags are not part of the critical path. Start them after the
    // first paint / idle period so they do not block hydration or LCP.
    if ("requestIdleCallback" in window) {
      idleHandle = window.requestIdleCallback(load, { timeout: 3000 });
    } else {
      timeout = setTimeout(load, 1500);
    }

    return () => {
      cancelled = true;
      if (idleHandle !== undefined) window.cancelIdleCallback(idleHandle);
      if (timeout) clearTimeout(timeout);
      if (settleTimer) clearTimeout(settleTimer);
      observer?.disconnect();
      scripts.forEach((script) => script.remove());
    };
  }, [gallery]);

  if (gallery) {
    return (
      <Card
        data-testid="share-gallery-ad"
        withBorder
        radius="md"
        p="sm"
        mb="xl"
        sx={{ display: collapsed ? "none" : "block" }}
      >
        <Text
          size="xs"
          color="dimmed"
          weight={600}
          tt="uppercase"
          mb={6}
          sx={{ letterSpacing: 0.5 }}
        >
          {t("share.custom.advertisement")}
        </Text>
        <Box
          ref={bannerRef}
          aria-label="Advertisement"
          sx={{
            display: "flex",
            justifyContent: "center",
            minHeight: 90,
            width: "100%",
          }}
        />
      </Card>
    );
  }

  return (
    <aside
      ref={bannerRef}
      aria-label="Advertisement"
      style={{
        display: collapsed ? "none" : "flex",
        justifyContent: "center",
        margin: collapsed ? 0 : "24px auto",
        minHeight: collapsed ? 0 : 90,
        width: "100%",
      }}
    />
  );
};

export default Ads;
