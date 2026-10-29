import { ActionIcon, createStyles } from "@mantine/core";
import Link from "next/link";
import { useRouter } from "next/router";
import { ReactNode } from "react";
import { HoverTip } from "../core/HoverTip";

const useStyles = createStyles((theme) => ({
  active: {
    backgroundColor:
      theme.colorScheme === "dark"
        ? theme.fn.rgba(theme.colors[theme.primaryColor][9], 0.35)
        : theme.colors[theme.primaryColor][0],
    color:
      theme.colors[theme.primaryColor][theme.colorScheme === "dark" ? 3 : 7],
  },
}));

/**
 * Icon-only navigation entry for the desktop header, matching the share menu
 * item. Keeps an accessible name and a hover tooltip because it has no text.
 */
const NavbarIconLink = ({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: ReactNode;
}) => {
  const { classes, cx } = useStyles();
  const router = useRouter();
  const active = router.pathname === href;

  return (
    <ActionIcon
      component={Link}
      href={href}
      aria-label={label}
      className={cx(active && classes.active)}
    >
      <HoverTip label={label}>
        <div>{children}</div>
      </HoverTip>
    </ActionIcon>
  );
};

export default NavbarIconLink;
