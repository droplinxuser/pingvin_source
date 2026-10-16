import { Button, createStyles, Group, Text } from "@mantine/core";
import useTranslate from "../../hooks/useTranslate.hook";
import { getOAuthIcon, getOAuthUrl } from "../../utils/oauth.util";

const useStyles = createStyles((theme) => ({
  divider: {
    fontWeight: 500,
    "&:before": {
      content: "''",
      flex: 1,
      display: "block",
    },
    "&:after": {
      content: "''",
      flex: 1,
      display: "block",
    },
  },
  dividerWithLine: {
    "&:before": {
      borderTopWidth: 1,
      borderTopStyle: "solid",
      borderColor:
        theme.colorScheme === "dark"
          ? theme.colors.dark[3]
          : theme.colors.gray[4],
    },
    "&:after": {
      borderTopWidth: 1,
      borderTopStyle: "solid",
      borderColor:
        theme.colorScheme === "dark"
          ? theme.colors.dark[3]
          : theme.colors.gray[4],
    },
  },
}));

// Renders the OAuth sign-in buttons of every configured provider. Shared by
// the sign-in and sign-up forms; both use the same provider URLs, and signing
// in with a provider automatically registers new users when allowed.
const OAuthButtons = ({
  providers,
  divider,
}: {
  providers: string[];
  divider?: "or" | "signInWith";
}) => {
  const t = useTranslate();
  const { classes, cx } = useStyles();

  if (providers.length == 0) return null;

  return (
    <>
      {divider && (
        <Group
          align="center"
          className={cx(
            classes.divider,
            divider == "or" && classes.dividerWithLine,
          )}
        >
          <Text>{t(`signIn.oauth.${divider}`)}</Text>
        </Group>
      )}
      <Group position="center">
        {providers.map((provider) => (
          <Button
            key={provider}
            component="a"
            title={t(`signIn.oauth.${provider}`)}
            href={getOAuthUrl(provider)}
            variant="light"
            fullWidth
          >
            {getOAuthIcon(provider)}
            {"\u2002" + t(`signIn.oauth.${provider}`)}
          </Button>
        ))}
      </Group>
    </>
  );
};

export default OAuthButtons;
