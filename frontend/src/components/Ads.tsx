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
    const scripts = SCRIPTS.map(({ src, banner }) => {
      const script = document.createElement("script");
      script.setAttribute("data-cfasync", "false");
      script.async = !!banner;
      script.src = src;
      (banner ? bannerRef.current : document.body)?.appendChild(script);
      return script;
    });

    return () => scripts.forEach((script) => script.remove());
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
