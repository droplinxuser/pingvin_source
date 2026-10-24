import { useEffect, useRef } from "react";

// Ad units from the publishers' original snippets. Banner scripts are inserted
// into the placeholder below, page-level scripts into <body>.
const SCRIPTS = [
  { src: "//iz.chaponrearing.com/t9EmdEo0Xr3P/157480", banner: true },
  { src: "https://grop.net/14/4d696fd2a6a11010f9f9e4cdbadc5907" },
  { src: "https://wingsmob.com/1/ccdff92c9d7f97c5af143f6c519f16ed" },
];

const Ads = () => {
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let idleHandle: number | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let scripts: HTMLScriptElement[] = [];

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
      scripts.forEach((script) => script.remove());
    };
  }, []);

  return (
    <aside
      ref={bannerRef}
      aria-label="Advertisement"
      style={{
        display: "flex",
        justifyContent: "center",
        margin: "24px auto",
        minHeight: 90,
        width: "100%",
      }}
    />
  );
};

export default Ads;
