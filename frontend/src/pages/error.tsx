import React from "react";
import { Button, createStyles, Stack, Text, Title } from "@mantine/core";
import Meta from "../components/Meta";
import useTranslate from "../hooks/useTranslate.hook";
import { useRouter } from "next/router";
import { FormattedMessage, useIntl } from "react-intl";
import useHomeHref from "../hooks/homeHref.hook";
import { getQueryString } from "../utils/router.util";

const useStyle = createStyles({
  title: {
    fontSize: 100,
  },
});

// Unknown query values must not produce a react-intl missing-message console
// error; only the keys shipped in the catalogue can select a message.
const ERROR_MESSAGE_KEYS = new Set([
  "default",
  "access_denied",
  "expired_token",
  "invalid_token",
  "no_user",
  "no_email",
  "already_linked",
  "not_linked",
  "email_already_exists",
  "email_not_verified",
  "unverified_account",
  "user_not_allowed",
  "cannot_get_user_info",
  "oidc_configuration_error",
]);

export default function Error() {
  const { classes } = useStyle();
  const t = useTranslate();
  const intl = useIntl();
  const router = useRouter();
  const homeHref = useHomeHref();

  const rawParams = getQueryString(router.query.params);
  const params = rawParams
    ? rawParams.split(",").map((param) =>
        intl.formatMessage({
          id: `error.param.${param}`,
          defaultMessage: param,
        }),
      )
    : [];
  const requestedError = getQueryString(router.query.error) || "default";
  const errorKey = ERROR_MESSAGE_KEYS.has(requestedError)
    ? requestedError
    : "default";

  return (
    <>
      <Meta title={t("error.title")} />
      <Stack align="center">
        <Title order={1} className={classes.title}>
          {t("error.description")}
        </Title>
        <Text mt="xl" size="lg">
          <FormattedMessage
            id={`error.msg.${errorKey}`}
            values={Object.fromEntries(
              params.map((value, index) => [String(index), value]),
            )}
          />
        </Text>
        <Button mt="xl" onClick={() => router.push(homeHref)}>
          {t("common.button.go-home")}
        </Button>
      </Stack>
    </>
  );
}
