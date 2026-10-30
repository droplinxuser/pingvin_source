import { useMantineColorScheme } from "@mantine/core";
import { useEffect, useRef } from "react";

type TurnstileOptions = {
  sitekey: string;
  theme?: "light" | "dark" | "auto";
  action?: string;
  callback: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
};

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: TurnstileOptions) => string;
      remove: (widgetId: string) => void;
    };
  }
}

const SCRIPT_SELECTOR = "script[data-pingvin-turnstile]";

/**
 * Cloudflare Turnstile widget. The script is loaded only on the contact page,
 * with explicit rendering so we can remove the widget when the route unmounts.
 */
const TurnstileWidget = ({
  siteKey,
  onVerify,
}: {
  siteKey: string;
  onVerify: (token: string) => void;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const verifyRef = useRef(onVerify);
  verifyRef.current = onVerify;
  const { colorScheme } = useMantineColorScheme();

  useEffect(() => {
    if (!siteKey) return;
    const container = containerRef.current;
    if (!container) return;

    let widgetId: string | undefined;
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;

    const render = () => {
      if (cancelled || !container || !window.turnstile || widgetId) return;
      try {
        widgetId = window.turnstile.render(container, {
          sitekey: siteKey,
          theme: colorScheme === "dark" ? "dark" : "light",
          action: "contact",
          callback: (token) => verifyRef.current(token),
          "expired-callback": () => verifyRef.current(""),
          "error-callback": () => verifyRef.current(""),
        });
      } catch {
        // The script can expose window.turnstile before the renderer is ready;
        // the polling timer retries once it is.
        widgetId = undefined;
      }
    };

    if (window.turnstile) {
      render();
    } else {
      let script = document.querySelector<HTMLScriptElement>(SCRIPT_SELECTOR);
      if (!script) {
        script = document.createElement("script");
        script.src =
          "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        script.dataset.pingvinTurnstile = "true";
        document.head.appendChild(script);
      }
      script.addEventListener("load", render);
      // Some browsers expose window.turnstile before the script's load event
      // fires. Poll briefly so the widget is not silently skipped on slow or
      // cached third-party loads.
      pollTimer = setInterval(() => {
        if (window.turnstile) {
          render();
          if (widgetId && pollTimer) clearInterval(pollTimer);
        }
      }, 250);
      return () => {
        cancelled = true;
        if (pollTimer) clearInterval(pollTimer);
        script?.removeEventListener("load", render);
        if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
      };
    }

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, colorScheme]);

  return <div ref={containerRef} data-testid="contact-turnstile" />;
};

export default TurnstileWidget;
