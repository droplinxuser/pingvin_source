import { Button, Container, createStyles, Group, Title } from "@mantine/core";
import Link from "next/link";
import { FormattedMessage } from "react-intl";
import Meta from "../components/Meta";
import Ads from "../components/Ads";
import useHomeHref from "../hooks/homeHref.hook";
import useTranslate from "../hooks/useTranslate.hook";

const useStyles = createStyles((theme) => ({
  root: {
    paddingTop: 80,
    paddingBottom: 80,
  },

  label: {
    textAlign: "center",
    fontWeight: 900,
    fontSize: 220,
    lineHeight: 1,
    marginBottom: 20,
    color: theme.colors.gray[2],

    [theme.fn.smallerThan("sm")]: {
      fontSize: 120,
    },
  },
}));

const ErrorNotFound = () => {
  const { classes } = useStyles();
  const homeHref = useHomeHref();
  const t = useTranslate();

  return (
    <>
      <Meta title={t("404.title")} noindex />
      <Container className={classes.root}>
        <div className={classes.label}>404</div>
        <Title align="center" order={1} size="h3">
          <FormattedMessage id="404.description" />
        </Title>
        <Group position="center" mt={50}>
          <Button component={Link} href={homeHref} variant="light">
            <FormattedMessage id="404.button.home" />
          </Button>
        </Group>
      </Container>
      <Ads />
    </>
  );
};
export default ErrorNotFound;
