import { useEffect, useRef } from "react";

// All ad scripts are injected the moment the page component mounts,
// with the exact same attributes as the publisher's original code
// and no artificial delay.

const Ads = () => {
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = bannerRef.current;

    // ProfitOn banner
    // Original: <div><script data-cfasync="false" async type="text/javascript" src="//iz.chaponrearing.com/t9EmdEo0Xr3P/157480"></script></div>
    if (container) {
      const bannerScript = document.createElement("script");
      bannerScript.setAttribute("data-cfasync", "false");
      bannerScript.async = true;
      bannerScript.type = "text/javascript";
      bannerScript.src = "//iz.chaponrearing.com/t9EmdEo0Xr3P/157480";
      container.appendChild(bannerScript);
    }

    // Social Bar
    // Original: <script data-cfasync="false" src="https://grop.net/14/4d696fd2a6a11010f9f9e4cdbadc5907"></script>
    const socialBarScript = document.createElement("script");
    socialBarScript.setAttribute("data-cfasync", "false");
    socialBarScript.async = false;
    socialBarScript.src = "https://grop.net/14/4d696fd2a6a11010f9f9e4cdbadc5907";
    document.body.appendChild(socialBarScript);

    // Popunder
    // Original: <script data-cfasync="false" src="https://wingsmob.com/1/ccdff92c9d7f97c5af143f6c519f16ed"></script>
    const popunderScript = document.createElement("script");
    popunderScript.setAttribute("data-cfasync", "false");
    popunderScript.async = false;
    popunderScript.src = "https://wingsmob.com/1/ccdff92c9d7f97c5af143f6c519f16ed";
    document.body.appendChild(popunderScript);

    return () => {
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
