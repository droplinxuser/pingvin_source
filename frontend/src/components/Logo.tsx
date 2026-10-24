import { useMantineColorScheme } from "@mantine/core";
import { useEffect, useState } from "react";
import useConfig from "../hooks/config.hook";

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
  const config = useConfig();
  const siteName =
    (config.get("general.appName") as string)?.trim() || "Pingvin Share";
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
      decoding="async"
      draggable={false}
      onError={() => {
        if (logoSrc !== fallback) setLogoSrc(fallback);
      }}
    />
  );
};
export default Logo;
