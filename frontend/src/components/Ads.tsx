import { useEffect, useRef } from "react";

// Profiton banner (rendered below the main content)
const PROFITON_BANNER_URL = "//iz.chaponrearing.com/t9EmdEo0Xr3P/157480";

// Legacy ad scripts (previously injected site-wide in _document.tsx)
const LEGACY_AD_URLS = [
  "https://wingsmob.com/1/ccdff92c9d7f97c5af143f6c519f16ed",
  "https://grop.net/14/4d696fd2a6a11010f9f9e4cdbadc5907",
];

const Ads = () => {
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timers: number[] = [];
    const container = bannerRef.current;

    // Profiton banner
    if (container) {
      const bannerScript = document.createElement("script");
      bannerScript.setAttribute("data-cfasync", "false");
      bannerScript.async = true;
      bannerScript.type = "text/javascript";
      bannerScript.src = PROFITON_BANNER_URL;
      container.appendChild(bannerScript);
    }

    // Legacy ad scripts
    const injectLegacyAds = () => {
      LEGACY_AD_URLS.forEach((src) => {
        timers.push(
          window.setTimeout(() => {
            const script = document.createElement("script");
            script.type = "text/javascript";
            script.src = src;
            document.body.appendChild(script);
          }, 1000),
        );
      });
    };

    if (document.readyState === "complete") {
      injectLegacyAds();
    } else {
      window.addEventListener("load", injectLegacyAds, { once: true });
    }

    return () => {
      window.removeEventListener("load", injectLegacyAds);
      timers.forEach((timer) => window.clearTimeout(timer));
      if (container) container.innerHTML = "";
    };
  }, []);

  return (
    <div
      ref={bannerRef}
      style={{
        display: "flex",
        justifyContent: "center",
        margin: "24px auto",
        width: "100%",
      }}
    />
  );
};

export default Ads;
