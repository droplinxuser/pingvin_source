import {
  Button,
  Container,
  createStyles,
  Group,
  List,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import Link from "next/link";
import { useEffect } from "react";
import { TbCheck } from "react-icons/tb";
import { FormattedMessage } from "react-intl";
import Logo from "../components/Logo";
import Meta from "../components/Meta";
import useConfig from "../hooks/config.hook";
import useSiteMeta from "../hooks/siteMeta.hook";
import useHomeHref from "../hooks/homeHref.hook";
import useTranslate from "../hooks/useTranslate.hook";
import { absoluteUrl, buildWebsiteRef } from "../utils/seo.util";

const useStyles = createStyles((theme) => ({
  inner: {
    display: "flex",
    justifyContent: "space-between",
    paddingTop: `calc(${theme.spacing.md} * 4)`,
    paddingBottom: `calc(${theme.spacing.md} * 4)`,
  },

  content: {
    maxWidth: 480,
    marginRight: `calc(${theme.spacing.md} * 3)`,

    [theme.fn.smallerThan("md")]: {
      maxWidth: "100%",
      marginRight: 0,
    },
  },

  title: {
    color: theme.colorScheme === "dark" ? theme.white : theme.black,
    fontSize: 44,
    lineHeight: 1.2,
    fontWeight: 900,

    [theme.fn.smallerThan("xs")]: {
      fontSize: 28,
    },
  },

  control: {
    [theme.fn.smallerThan("xs")]: {
      flex: 1,
    },
  },

  image: {
    [theme.fn.smallerThan("md")]: {
      display: "none",
    },
  },

  highlight: {
    position: "relative",
    backgroundColor:
      theme.colorScheme === "dark"
        ? theme.fn.rgba(theme.colors[theme.primaryColor][6], 0.55)
        : theme.colors[theme.primaryColor][0],
    borderRadius: theme.radius.sm,
    padding: "4px 12px",
  },
}));

export default function Home() {
  const { classes } = useStyles();
  const config = useConfig();
  const homeHref = useHomeHref();
  const t = useTranslate();
  const { siteName, baseUrl } = useSiteMeta();

  // Never render the home page when a higher-priority destination exists
  // (signed in or home page disabled): redirect straight to it. `_app` already
  // restores the signed-in user from the access token, so no extra user
  // request is needed here.
  const redirectTarget = homeHref !== "/" ? homeHref : null;

  useEffect(() => {
    // A client-side replace here can stall when the access token was expired
    // on first open and the client has just refreshed it. The home page has
    // already rendered by then, so use a full navigation to the protected
    // destination instead of a router transition.
    if (redirectTarget) window.location.replace(redirectTarget);
  }, [redirectTarget]);

  const description = t("home.custom.metaDescription", { siteName });
  const aboutHref = (config.get("legal.imprintUrl") as string) || "/imprint";
  const aboutIsExternal = /^https?:\/\//i.test(aboutHref);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: siteName,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Any",
    url: absoluteUrl("/", baseUrl),
    description,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    isPartOf: buildWebsiteRef(siteName, baseUrl),
  };

  if (redirectTarget) return null;

  return (
    <>
      <Meta
        title={t("home.custom.metaTitle")}
        description={description}
        canonicalPath="/"
        jsonLd={jsonLd}
      />
      <section aria-labelledby="home-title">
        <Container>
          <div className={classes.inner}>
            <div className={classes.content}>
              <Title id="home-title" order={1} className={classes.title}>
                <FormattedMessage
                  id="home.custom.title"
                  values={{
                    siteName,
                    h: (chunks) => (
                      <span className={classes.highlight}>{chunks}</span>
                    ),
                  }}
                />
              </Title>
              <Text color="dimmed" mt="md">
                <FormattedMessage id="home.custom.description" />
              </Text>

              <List
                mt={30}
                spacing="sm"
                size="sm"
                icon={
                  <ThemeIcon size={20} radius="xl">
                    <TbCheck size={12} />
                  </ThemeIcon>
                }
              >
                <List.Item>
                  <div>
                    <b>
                      <FormattedMessage id="home.custom.bullet.a.name" />
                    </b>{" "}
                    - <FormattedMessage id="home.custom.bullet.a.description" />
                  </div>
                </List.Item>
                <List.Item>
                  <div>
                    <b>
                      <FormattedMessage id="home.custom.bullet.b.name" />
                    </b>{" "}
                    - <FormattedMessage id="home.custom.bullet.b.description" />
                  </div>
                </List.Item>
                <List.Item>
                  <div>
                    <b>
                      <FormattedMessage id="home.custom.bullet.c.name" />
                    </b>{" "}
                    - <FormattedMessage id="home.custom.bullet.c.description" />
                  </div>
                </List.Item>
              </List>

              <Group mt={30}>
                <Button
                  component={Link}
                  href="/upload"
                  radius="xl"
                  size="md"
                  className={classes.control}
                >
                  <FormattedMessage id="home.custom.button.start" />
                </Button>
                <Button
                  component={Link}
                  href={aboutHref}
                  target={aboutIsExternal ? "_blank" : undefined}
                  variant="default"
                  radius="xl"
                  size="md"
                  className={classes.control}
                >
                  <FormattedMessage id="home.custom.button.source" />
                </Button>
              </Group>
            </div>
            <Group className={classes.image} align="center">
              <Logo width={200} height={200} />
            </Group>
          </div>
        </Container>
      </section>
    </>
  );
}
