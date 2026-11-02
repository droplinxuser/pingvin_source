import {
  Badge,
  Box,
  Divider,
  Group,
  Paper,
  ThemeIcon,
} from "@mantine/core";
import { getCookie } from "cookies-next/client";
import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { TbSpeakerphone } from "react-icons/tb";
import useTranslate from "../hooks/useTranslate.hook";
import useUser from "../hooks/user.hook";
import { scheduleAfterLoad } from "../utils/idle.util";

// Ad units are only mounted on share and 404 pages. The first two are
// page-level scripts and must not compete with the page's own requests, so
// they wait for the load event. The two banners are placed next to the
// gallery/comment blocks and load after the browser is idle.
const SOCIAL_BAR =
  "https://grop.net/14/4d696fd2a6a11010f9f9e4cdbadc5907";
const POPUNDER =
  "https://wingsmob.com/1/ccdff92c9d7f97c5af143f6c519f16ed";
const PROFITON_BANNER =
  "//yg.puceronplouky.com/t45SZ6ddnqC5M/157480";
const CLICKADU_SCRIPT = "//boxypluckunrelated.com/bn.js";
const CLICKADU_SPOT = "2158410";

/** Guests only: signed-in users and reverse-share uploaders never see ads. */
const useAdsGuest = () => {
  const { user } = useUser();
  const [isGuest, setIsGuest] = useState(false);

  useEffect(() => {
    setIsGuest(
      !user && !getCookie("access_token") && !getCookie("reverse_share_token"),
    );
  }, [user]);

  return isGuest;
};

/** Same accessible labels the old ad slot applied to injected markup. */
const labelAdNodes = () => {
  document.querySelectorAll("iframe:not([title])").forEach((frame) => {
    frame.setAttribute("title", "Advertisement");
  });
  document.querySelectorAll("a[href]").forEach((link) => {
    if (link.closest("#__next")) return;
    if (link.getAttribute("aria-label") || link.getAttribute("aria-labelledby"))
      return;
    const hasText = !!link.textContent?.trim();
    const imageAlt = link.querySelector("img[alt]:not([alt=''])");
    if (!hasText && !imageAlt) link.setAttribute("aria-label", "Advertisement");
  });
};

/**
 * Ad networks insert their markup after our script tag. Label newly added nodes
 * outside the app immediately (coalesced to one pass per animation frame) so a
 * keyboard or screen-reader user never meets an unnamed ad link, even before
 * the next periodic pass.
 */
const watchAdNodes = () => {
  let frame: number | undefined;
  const schedule = () => {
    if (frame !== undefined) return;
    frame = window.requestAnimationFrame(() => {
      frame = undefined;
      labelAdNodes();
    });
  };
  labelAdNodes();
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (node instanceof Element && !node.closest("#__next")) {
          schedule();
          return;
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    if (frame !== undefined) window.cancelAnimationFrame(frame);
  };
};

const createScript = (
  src: string,
  { async = true, type }: { async?: boolean; type?: string } = {},
) => {
  const script = document.createElement("script");
  script.src = src;
  script.async = async;
  script.setAttribute("data-cfasync", "false");
  if (type) script.type = type;
  return script;
};

/**
 * The networks inject their banner markup asynchronously. Track whether a
 * visible node actually landed so an unfilled or blocked slot can stay at zero
 * height instead of reserving an empty card.
 */
const useAdFilled = (
  containerRef: RefObject<HTMLDivElement>,
  enabled: boolean,
) => {
  const [filled, setFilled] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setFilled(false);
      return;
    }
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const isVisible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return rect.width >= 20 && rect.height >= 10;
      };
      // Networks usually render an iframe/image/link. The one-pixel tracking
      // div that Profiton inserts must not turn the empty card on by itself.
      const hasVisibleContent =
        Array.from(
          container.querySelectorAll(
            "iframe, img, video, canvas, object, embed, ins, a[href]",
          ),
        ).some(isVisible) ||
        Array.from(container.querySelectorAll("[id], [class]")).some(
          (element) =>
            /(^|[-_ ])(ad|ads|advert|banner|sponsor)([-_ ]|$)/i.test(
              `${element.id} ${element.getAttribute("class") ?? ""}`,
            ) && isVisible(element),
        );
      setFilled(hasVisibleContent);
    };

    measure();
    // Banner scripts resize their frame while it loads. Coalesce mutation
    // bursts into one layout read per animation frame instead of one per
    // attribute change.
    let frame: number | undefined;
    const schedule = () => {
      if (frame !== undefined) return;
      frame = window.requestAnimationFrame(() => {
        frame = undefined;
        measure();
      });
    };
    const observer = new MutationObserver(schedule);
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    return () => {
      observer.disconnect();
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [containerRef, enabled]);

  return filled;
};

/**
 * Shared chrome for the two in-page banners. It mirrors the comments section:
 * a bordered card, a small icon tile, an h2 and a light badge. The card itself
 * only appears once the network has filled the slot.
 */
const AdCard = ({
  titleId,
  filled,
  containerRef,
  children,
}: {
  titleId: string;
  filled: boolean;
  containerRef: RefObject<HTMLDivElement>;
  children?: ReactNode;
}) => {
  const t = useTranslate();

  return (
    <Paper
      component="section"
      aria-label={filled ? t("common.custom.ad") : undefined}
      radius="md"
      p={filled ? { base: "xs", sm: "sm" } : 0}
      mt={filled ? "lg" : 0}
      mb={filled ? "md" : 0}
      withBorder={filled}
      data-testid={titleId}
    >
      {filled && (
        <>
          <Group spacing="xs" align="center" noWrap>
            <ThemeIcon size={32} radius="sm" variant="light" color="gray">
              <TbSpeakerphone size={17} />
            </ThemeIcon>
            <Badge size="sm" radius="sm" variant="light" color="gray">
              {t("common.custom.ad")}
            </Badge>
          </Group>
          <Divider my="sm" />
        </>
      )}
      <Box
        ref={containerRef}
        sx={{
          width: "100%",
          // Keep the Clickadu spot as a normal block (a flex item would
          // collapse its width) and center the rendered banner instead.
          textAlign: "center",
          "& iframe": { maxWidth: "100%", border: 0, margin: "0 auto" },
          "& img": { maxWidth: "100%", height: "auto" },
        }}
      >
        {children}
      </Box>
    </Paper>
  );
};

/**
 * Profiton banner, placed immediately after the media gallery. The empty
 * wrapper takes no height until the network fills it.
 */
export const AfterGalleryAd = () => {
  const isGuest = useAdsGuest();
  const containerRef = useRef<HTMLDivElement>(null);
  const filled = useAdFilled(containerRef, isGuest);

  useEffect(() => {
    if (!isGuest) return;
    const container = containerRef.current;
    if (!container) return;

    let script: HTMLScriptElement | undefined;
    let cancelIdle: () => void = () => {};
    let stopLabeling: (() => void) | undefined;
    const load = () => {
      script = createScript(PROFITON_BANNER, { type: "text/javascript" });
      container.appendChild(script);
      stopLabeling = watchAdNodes();
    };
    cancelIdle = scheduleAfterLoad(load);

    return () => {
      cancelIdle();
      stopLabeling?.();
      script?.remove();
    };
  }, [isGuest]);

  if (!isGuest) return null;

  return (
    <AdCard
      titleId="ad-gallery-title"
      filled={filled}
      containerRef={containerRef}
    />
  );
};

/**
 * Clickadu banner, placed directly below the comment block. The spot element
 * is present before the loader script so the network can find it.
 */
export const AfterCommentsAd = () => {
  const isGuest = useAdsGuest();
  const containerRef = useRef<HTMLDivElement>(null);
  const filled = useAdFilled(containerRef, isGuest);

  useEffect(() => {
    if (!isGuest) return;
    const container = containerRef.current;
    if (!container) return;

    let script: HTMLScriptElement | undefined;
    let cancelIdle: () => void = () => {};
    let stopLabeling: (() => void) | undefined;
    const load = () => {
      script = createScript(CLICKADU_SCRIPT, { type: "text/javascript" });
      script.setAttribute("data-clbaid", "");
      container.appendChild(script);
      stopLabeling = watchAdNodes();
    };
    cancelIdle = scheduleAfterLoad(load);

    return () => {
      cancelIdle();
      stopLabeling?.();
      script?.remove();
    };
  }, [isGuest]);

  if (!isGuest) return null;

  return (
    <AdCard
      titleId="ad-comments-title"
      filled={filled}
      containerRef={containerRef}
    >
      <div data-cl-spot={CLICKADU_SPOT} />
    </AdCard>
  );
};

/**
 * Page-level social bar and popunder. They load once the document is complete
 * and the browser is idle, so they never delay the share page's own data.
 */
export const PageBottomAds = () => {
  const isGuest = useAdsGuest();

  useEffect(() => {
    if (!isGuest) return;

    let cancelled = false;
    let scripts: HTMLScriptElement[] = [];
    let stopLabeling: (() => void) | undefined;

    const load = () => {
      if (cancelled) return;
      scripts = [
        createScript(SOCIAL_BAR, { async: false }),
        createScript(POPUNDER, { async: false }),
      ];
      scripts.forEach((script) => document.body.appendChild(script));
      stopLabeling = watchAdNodes();
    };
    const cancelLoad = scheduleAfterLoad(load);

    return () => {
      cancelled = true;
      cancelLoad();
      stopLabeling?.();
      scripts.forEach((script) => script.remove());
    };
  }, [isGuest]);

  return null;
};
