import { useMantineColorScheme } from "@mantine/core";
import { useEffect, useState } from "react";
import useSiteMeta from "../hooks/siteMeta.hook";

const lightLogo = "/img/logo.webp";
const lightLogoFallback = "/img/logo.png";
const darkLogo = "/img/logo-dark.webp";
const darkLogoFallback = "/img/logo-dark.png";

const Logo = ({
  height,
  width,
  alt,
}: {
  height: number;
  width: number;
  alt?: string;
}) => {
  const { colorScheme } = useMantineColorScheme();
  const { siteName } = useSiteMeta();
  const [preferred, fallback] =
    colorScheme === "dark"
      ? [darkLogo, darkLogoFallback]
      : [lightLogo, lightLogoFallback];
  const [logoSrc, setLogoSrc] = useState(preferred);

  useEffect(() => {
    setLogoSrc(preferred);
  }, [preferred]);

  return (
    <img
      src={logoSrc}
      alt={alt ?? `${siteName} logo`}
      height={height}
      width={width}
      // Preserve the uploaded logo's intrinsic ratio; a fixed square would
      // stretch non-square branding and fail aspect-ratio audits.
      style={{ height: "auto" }}
      decoding="async"
      draggable={false}
      onError={() => {
        if (logoSrc !== fallback) setLogoSrc(fallback);
      }}
    />
  );
};
export default Logo;
