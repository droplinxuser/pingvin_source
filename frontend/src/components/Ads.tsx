import { Card } from "@mantine/core";
import { getCookie } from "cookies-next/client";
import { useEffect, useRef, useState } from "react";
import useUser from "../hooks/user.hook";

// Ad units from the publishers' original snippets. Banner scripts are inserted
// into the placeholder below, page-level scripts into <body>.
const SCRIPTS = [
  { src: "//iz.chaponrearing.com/t9EmdEo0Xr3P/157480", banner: true },
  { src: "https://grop.net/14/4d696fd2a6a11010f9f9e4cdbadc5907" },
  { src: "https://wingsmob.com/1/ccdff92c9d7f97c5af143f6c519f16ed" },
];

const Ads = ({
  gallery = false,
  disabled = false,
}: {
  gallery?: boolean;
  disabled?: boolean;
}) => {
  const bannerRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [isGuest, setIsGuest] = useState(false);
  const { user } = useUser();

  // Public pages are served as anonymous shells even for signed-in visitors.
  // Resolve the session in the browser before mounting the ad slot so account
  // holders never execute or see the publisher scripts.
  useEffect(() => {
    // Never inject third-party scripts on a protected share (its password and
    // recipient state must not sit next to arbitrary publisher code), or while
    // a reverse-share cookie grants upload permission to page scripts.
    if (disabled) {
      setIsGuest(false);
      return;
    }
    setIsGuest(
      !user && !getCookie("access_token") && !getCookie("reverse_share_token"),
    );
  }, [user, disabled]);

  useEffect(() => {
    if (!isGuest) return;

    let cancelled = false;
    let idleHandle: number | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let observer: MutationObserver | undefined;
    let a11yTimer: ReturnType<typeof setInterval> | undefined;
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

    // Ad networks inject iframes and full-page anchors without names. Label
    // those nodes as advertising so screen readers do not announce an unnamed
    // frame/link. The app itself renders no iframes, so this only touches
    // injected ad markup.
    const labelAdNodes = () => {
      document.querySelectorAll("iframe:not([title])").forEach((frame) => {
        frame.setAttribute("title", "Advertisement");
      });
      document
        .querySelectorAll("body > div:not(#__next) > a")
        .forEach((link) => {
          if (!link.textContent?.trim() && !link.getAttribute("aria-label"))
            link.setAttribute("aria-label", "Advertisement");
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
      labelAdNodes();
      // Ad scripts inject their iframe/overlay a moment after the tag loads.
      // A short interval keeps the audit clean without observing every React
      // DOM mutation on the page.
      a11yTimer = setInterval(labelAdNodes, 1000);
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
      if (a11yTimer) clearInterval(a11yTimer);
      scripts.forEach((script) => script.remove());
    };
  }, [isGuest]);

  if (disabled || !isGuest) return null;

  // Keep one stable DOM node for every page variant. The share page switches
  // the `gallery` layout after its data arrives; swapping an <aside> for a
  // Card here used to unmount the element that held the injected ad scripts
  // (and any popup opener), so the scripts were torn down and re-injected.
  // Conditional props/styles now change the same node and the scripts keep
  // running for the lifetime of the page.
  return (
    <Card
      ref={bannerRef}
      data-testid={gallery ? "share-gallery-ad" : undefined}
      role="complementary"
      aria-label="Advertisement"
      withBorder={gallery}
      radius={gallery ? "md" : undefined}
      p={gallery ? "sm" : 0}
      mb={gallery ? "xl" : 0}
      sx={{
        display: collapsed ? "none" : "flex",
        justifyContent: "center",
        alignItems: "center",
        width: "100%",
        minHeight: collapsed ? 0 : 90,
        ...(gallery
          ? {}
          : { margin: "24px auto", background: "transparent", border: 0 }),
      }}
    >
      <span style={{ display: "none" }} />
    </Card>
  );
};

export default Ads;
