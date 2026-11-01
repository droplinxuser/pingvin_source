import type { IconType } from "react-icons";
import {
  FaAndroid,
  FaApple,
  FaChrome,
  FaEdge,
  FaFirefox,
  FaLinux,
  FaOpera,
  FaSafari,
  FaWindows,
} from "react-icons/fa";
import { SiBrave, SiIos } from "react-icons/si";
import { TbBrowser, TbDeviceLaptop } from "react-icons/tb";

const ICON_SIZE = 16;
const UNKNOWN_ICON_COLOR = "#868E96";
const ICONS: Record<string, { Icon: IconType; color: string }> = {
  Windows: { Icon: FaWindows, color: "#0078D4" },
  macOS: { Icon: FaApple, color: "#8E8E93" },
  Linux: { Icon: FaLinux, color: "#E5A50A" },
  Android: { Icon: FaAndroid, color: "#3DDC84" },
  iOS: { Icon: SiIos, color: "#8E8E93" },
  ChromeOS: { Icon: FaChrome, color: "#4285F4" },
  Chrome: { Icon: FaChrome, color: "#4285F4" },
  Firefox: { Icon: FaFirefox, color: "#FF7139" },
  Safari: { Icon: FaSafari, color: "#006CFF" },
  Edge: { Icon: FaEdge, color: "#0078D4" },
  Opera: { Icon: FaOpera, color: "#FF1B2D" },
  Brave: { Icon: SiBrave, color: "#FB542B" },
};

const renderIcon = (name: string | undefined, Fallback: IconType) => {
  const entry = ICONS[name ?? ""];
  const Icon = entry?.Icon ?? Fallback;
  return (
    <Icon
      size={ICON_SIZE}
      color={entry?.color ?? UNKNOWN_ICON_COLOR}
      // The surrounding badge carries the translated label; the brand glyph is
      // decorative and should not become a separate image node.
      aria-hidden
    />
  );
};

export const getOsIcon = (os?: string) => renderIcon(os, TbDeviceLaptop);

export const getBrowserIcon = (browser?: string) =>
  renderIcon(browser, TbBrowser);

export const iconStyle = {
  display: "inline-flex",
  alignItems: "center",
  cursor: "help",
} as const;
