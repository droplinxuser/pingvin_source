import {
  Box,
  Burger,
  Container,
  createStyles,
  Group,
  Header as MantineHeader,
  Paper,
  Stack,
  Text,
  Transition,
  UnstyledButton,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import Link from "next/link";
import { useRouter } from "next/router";
import { ReactNode, useEffect, useState } from "react";
import { TbChevronLeft } from "react-icons/tb";
import useConfig from "../../hooks/config.hook";
import useUser from "../../hooks/user.hook";
import useTranslate from "../../hooks/useTranslate.hook";
import authService from "../../services/auth.service";
import Logo from "../Logo";
import useHomeHref from "../../hooks/homeHref.hook";
import ActionAvatar from "./ActionAvatar";
import NavbarNewMenu from "./NavbarNewMenu";
import NavbarSearch from "./NavbarSearch";
import NavbarShareMenu from "./NavbarShareMenu";

const HEADER_HEIGHT = 54;

type NavLink = {
  link?: string;
  label?: string;
  component?: ReactNode;
  action?: () => Promise<void>;
};

type MobileMenuView = "root" | "shares" | "profile" | "new";

const useStyles = createStyles((theme) => ({
  root: {
    position: "sticky",
    top: 0,
    zIndex: 100,
    backgroundColor:
      theme.colorScheme === "dark"
        ? theme.fn.rgba(theme.colors.dark[7], 0.92)
        : theme.fn.rgba(theme.white, 0.92),
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    borderBottom: `1px solid ${
      theme.colorScheme === "dark" ? theme.colors.dark[5] : theme.colors.gray[2]
    }`,
    transition: "box-shadow 150ms ease, background-color 150ms ease",
  },

  headerScrolled: {
    boxShadow: theme.shadows.sm,
  },

  mobilePanel: {
    position: "fixed",
    top: HEADER_HEIGHT,
    left: 0,
    right: 0,
    zIndex: 99,
    maxHeight: `calc(100vh - ${HEADER_HEIGHT}px)`,
    overflowY: "auto",
    boxShadow: theme.shadows.md,
    borderTopRightRadius: 0,
    borderTopLeftRadius: 0,
    borderTopWidth: 0,

    [theme.fn.largerThan("sm")]: {
      display: "none",
    },
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    height: "100%",
  },

  links: {
    [theme.fn.smallerThan("sm")]: {
      display: "none",
    },
  },

  burger: {
    [theme.fn.largerThan("sm")]: {
      display: "none",
    },
  },

  // The mobile search icon + burger live here. On desktop both are hidden, so
  // the wrapper must not stay as an empty flex child (that would leave a gap
  // after the avatar under `space-between`).
  rightControls: {
    [theme.fn.largerThan("sm")]: {
      display: "none",
    },
  },

  link: {
    display: "block",
    lineHeight: 1,
    padding: "8px 12px",
    borderRadius: theme.radius.sm,
    textDecoration: "none",
    color:
      theme.colorScheme === "dark"
        ? theme.colors.dark[0]
        : theme.colors.gray[7],
    fontSize: theme.fontSizes.sm,
    fontWeight: 500,

    "&:hover": {
      backgroundColor:
        theme.colorScheme === "dark"
          ? theme.colors.dark[6]
          : theme.colors.gray[0],
    },

    [theme.fn.smallerThan("sm")]: {
      borderRadius: 0,
      padding: theme.spacing.md,
    },
  },

  mobileMenuButton: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: theme.spacing.md,
    color:
      theme.colorScheme === "dark"
        ? theme.colors.dark[0]
        : theme.colors.gray[7],

    "&:hover": {
      backgroundColor:
        theme.colorScheme === "dark"
          ? theme.colors.dark[6]
          : theme.colors.gray[0],
    },
  },

  mobileMenuButtonContent: {
    display: "flex",
    alignItems: "center",
  },

  mobileMenuLabel: {
    fontSize: theme.fontSizes.sm,
    fontWeight: 500,
  },

  linkActive: {
    "&, &:hover": {
      backgroundColor:
        theme.colorScheme === "dark"
          ? theme.fn.rgba(theme.colors[theme.primaryColor][9], 0.25)
          : theme.colors[theme.primaryColor][0],
      color:
        theme.colors[theme.primaryColor][theme.colorScheme === "dark" ? 3 : 7],
    },
  },

  // The logo still identifies the site, so drop the wordmark on narrower
  // desktops to keep the all-text navigation from crowding the search box.
  appName: {
    [theme.fn.smallerThan("lg")]: {
      display: "none",
    },
  },
}));

const Header = () => {
  const { user } = useUser();
  const router = useRouter();
  const config = useConfig();
  const homeHref = useHomeHref();
  const t = useTranslate();

  const isShareOrUploadPage = [
    "/upload/[reverseShareToken]",
    "/share/[shareId]",
  ].includes(router.pathname);
  const showAuthButtons = config.get("general.showAuthButtons");
  const shouldHideAuthButtons = !showAuthButtons && isShareOrUploadPage;

  const [opened, { toggle, close }] = useDisclosure(false);
  const [currentRoute, setCurrentRoute] = useState("");
  const [mobileMenuView, setMobileMenuView] = useState<MobileMenuView>("root");
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 2);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setCurrentRoute(router.pathname);
    close();
    setMobileMenuView("root");
  }, [close, router.pathname]);

  // Every desktop entry uses the same text pill: text for destinations, icons
  // only for controls (the share dropdown and the avatar).
  const authenticatedLinks: NavLink[] = [
    ...(user?.allowShare !== false
      ? [
          {
            link: "/upload",
            label: t("navbar.upload"),
          },
        ]
      : []),
    { link: "/trending", label: t("navbar.trending") },
    {
      component: (
        <NavbarNewMenu
          active={
            currentRoute === "/new-media" || currentRoute === "/new-files"
          }
        />
      ),
    },
    {
      component: <NavbarShareMenu />,
    },
    {
      component: <ActionAvatar />,
    },
  ];

  const buildUnauthenticatedLinks = (desktop: boolean): NavLink[] => {
    const links: NavLink[] = [];
    if (config.get("general.showHomePage"))
      links.push({ link: "/", label: t("navbar.home") });

    if (config.get("security.allowUnauthenticatedShares"))
      links.push({ link: "/upload", label: t("navbar.upload") });

    links.push({ link: "/trending", label: t("navbar.trending") });
    links.push(
      desktop
        ? {
            component: (
              <NavbarNewMenu
                active={
                  currentRoute === "/new-media" || currentRoute === "/new-files"
                }
              />
            ),
          }
        : { label: t("navbar.new") },
    );

    if (!shouldHideAuthButtons)
      links.push({ link: "/auth/signIn", label: t("navbar.signin") });

    if (config.get("security.allowRegistration") && !shouldHideAuthButtons)
      links.push({ link: "/auth/signUp", label: t("navbar.signup") });

    return links;
  };

  const unauthenticatedLinks = buildUnauthenticatedLinks(false);
  const desktopUnauthenticatedLinks = buildUnauthenticatedLinks(true);

  const mobileRootLinks: NavLink[] = user
    ? [
        ...(user.allowShare !== false
          ? [
              {
                link: "/upload",
                label: t("navbar.upload"),
              },
            ]
          : []),
        {
          link: "/trending",
          label: t("navbar.trending"),
        },
        {
          label: t("navbar.new"),
        },
        {
          label: t("common.button.shares"),
        },
        {
          label: t("common.button.profile"),
        },
      ]
    : unauthenticatedLinks;

  const mobileShareLinks: NavLink[] = [
    {
      link: "/account/shares",
      label: t("navbar.links.shares"),
    },
    {
      link: "/account/reverseShares",
      label: t("navbar.links.reverse"),
    },
    ...(config.get("share.enableUserRecipients")
      ? [
          {
            link: "/account/received",
            label: t("navbar.links.received"),
          },
        ]
      : []),
  ];

  const mobileNewLinks: NavLink[] = [
    {
      link: "/new-media",
      label: t("navbar.newMedia"),
    },
    {
      link: "/new-files",
      label: t("navbar.newFiles"),
    },
  ];

  const mobileProfileLinks: NavLink[] = [
    {
      link: "/account",
      label: t("navbar.avatar.account"),
    },
    ...(user?.isAdmin
      ? [
          {
            link: "/admin",
            label: t("navbar.avatar.admin"),
          },
        ]
      : []),
    {
      label: t("navbar.avatar.signout"),
      action: async () => {
        await authService.signOut();
        close();
        setMobileMenuView("root");
      },
    },
  ];

  const { classes, cx } = useStyles();
  const desktopItems = (
    <>
      {(user ? authenticatedLinks : desktopUnauthenticatedLinks).map(
        (link, i) => {
          if (link.component) {
            return (
              <Box pl={5} py={12} key={i}>
                {link.component}
              </Box>
            );
          }
          return (
            <Link
              key={link.label}
              href={link.link ?? ""}
              onClick={close}
              aria-current={currentRoute == link.link ? "page" : undefined}
              className={cx(classes.link, {
                [classes.linkActive]: currentRoute == link.link,
              })}
            >
              {link.label}
            </Link>
          );
        },
      )}
    </>
  );

  const currentMobileLinks =
    mobileMenuView === "shares"
      ? mobileShareLinks
      : mobileMenuView === "profile"
        ? mobileProfileLinks
        : mobileMenuView === "new"
          ? mobileNewLinks
          : mobileRootLinks;

  const renderMobileEntry = (link: NavLink) => {
    const isSharesEntry =
      mobileMenuView === "root" && link.label === t("common.button.shares");
    const isProfileEntry =
      mobileMenuView === "root" && link.label === t("common.button.profile");
    const isNewEntry =
      mobileMenuView === "root" && link.label === t("navbar.new");

    if (isSharesEntry || isProfileEntry || isNewEntry) {
      return (
        <UnstyledButton
          key={link.label}
          className={classes.mobileMenuButton}
          onClick={() =>
            setMobileMenuView(
              isSharesEntry ? "shares" : isProfileEntry ? "profile" : "new",
            )
          }
        >
          <span className={classes.mobileMenuButtonContent}>
            <Text className={classes.mobileMenuLabel}>{link.label}</Text>
          </span>
        </UnstyledButton>
      );
    }

    if (link.action) {
      return (
        <UnstyledButton
          key={link.label}
          className={classes.mobileMenuButton}
          onClick={() => void link.action?.()}
        >
          <span className={classes.mobileMenuButtonContent}>
            <Text className={classes.mobileMenuLabel}>{link.label}</Text>
          </span>
        </UnstyledButton>
      );
    }

    return (
      <Link
        key={link.label}
        href={link.link ?? ""}
        onClick={() => {
          close();
          setMobileMenuView("root");
        }}
        aria-current={currentRoute == link.link ? "page" : undefined}
        className={cx(classes.link, {
          [classes.linkActive]: currentRoute == link.link,
        })}
      >
        {link.label}
      </Link>
    );
  };
  return (
    <>
      <MantineHeader
        height={HEADER_HEIGHT}
        mb={0}
        className={cx(classes.root, {
          [classes.headerScrolled]: isScrolled,
        })}
      >
        <Container className={classes.header}>
          <Group spacing="lg" noWrap>
            <Link
              href={homeHref}
              passHref
              aria-label={`${config.get("general.appName")} home`}
            >
              <Group spacing="xs">
                <Logo height={30} width={30} />
                <Text weight={600} size="sm" className={classes.appName}>
                  {config.get("general.appName")}
                </Text>
              </Group>
            </Link>
            <NavbarSearch part="desktop" />
          </Group>
          <Box
            component="nav"
            aria-label={t("navbar.custom.primary")}
            className={classes.links}
          >
            <Group spacing="xs">{desktopItems}</Group>
          </Box>
          <Group spacing="xs" noWrap className={classes.rightControls}>
            <NavbarSearch part="mobile" />
            <Burger
              opened={opened}
              onClick={toggle}
              className={classes.burger}
              size="sm"
              aria-label={t("navbar.custom.open-menu")}
              aria-expanded={opened}
              aria-controls="mobile-navigation"
            />
          </Group>
        </Container>
      </MantineHeader>
      <Transition transition="scale-y" duration={20} mounted={opened}>
        {(styles) => (
          <Paper
            id="mobile-navigation"
            component="nav"
            aria-label={t("navbar.custom.primary")}
            className={classes.mobilePanel}
            withBorder
            style={styles}
          >
            <Stack spacing={0}>
              {mobileMenuView !== "root" && (
                <UnstyledButton
                  className={classes.mobileMenuButton}
                  aria-label={t("navbar.custom.back")}
                  onClick={() => setMobileMenuView("root")}
                >
                  <span className={classes.mobileMenuButtonContent}>
                    <TbChevronLeft size={18} />
                  </span>
                </UnstyledButton>
              )}
              {currentMobileLinks.map((link) => renderMobileEntry(link))}
            </Stack>
          </Paper>
        )}
      </Transition>
    </>
  );
};

export default Header;
