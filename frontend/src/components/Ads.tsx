import { useEffect, useRef } from "react";

// Ad units from the publishers' original snippets.
const AD_SCRIPTS: {
  src: string;
  async: boolean;
  type?: string;
  inBanner?: boolean;
}[] = [
  // ProfitOn banner
  {
    src: "//iz.chaponrearing.com/t9EmdEo0Xr3P/157480",
    async: true,
    type: "text/javascript",
    inBanner: true,
  },
  // Social bar
  { src: "https://grop.net/14/4d696fd2a6a11010f9f9e4cdbadc5907", async: false },
  // Popunder
  {
    src: "https://wingsmob.com/1/ccdff92c9d7f97c5af143f6c519f16ed",
    async: false,
  },
];

const Ads = () => {
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    for (const { src, async, type, inBanner } of AD_SCRIPTS) {
      const target = inBanner ? bannerRef.current : document.body;
      if (!target) continue;

      const script = document.createElement("script");
      script.setAttribute("data-cfasync", "false");
      script.async = async;
      if (type) script.type = type;
      script.src = src;
      target.appendChild(script);
    }

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
