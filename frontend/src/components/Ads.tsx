import { useEffect, useRef } from "react";

// Ad units from the publishers' original snippets
const BANNER_SCRIPTS = ["//iz.chaponrearing.com/t9EmdEo0Xr3P/157480"];
const BODY_SCRIPTS = [
  "https://grop.net/14/4d696fd2a6a11010f9f9e4cdbadc5907",
  "https://wingsmob.com/1/ccdff92c9d7f97c5af143f6c519f16ed",
];

const Ads = () => {
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadScript = (src: string, target: HTMLElement, async?: boolean) => {
      const script = document.createElement("script");
      script.setAttribute("data-cfasync", "false");
      script.async = !!async;
      script.src = src;
      target.appendChild(script);
    };

    BANNER_SCRIPTS.forEach(
      (src) => bannerRef.current && loadScript(src, bannerRef.current, true),
    );
    BODY_SCRIPTS.forEach((src) => loadScript(src, document.body));

    return () => {
      if (bannerRef.current) bannerRef.current.innerHTML = "";
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
