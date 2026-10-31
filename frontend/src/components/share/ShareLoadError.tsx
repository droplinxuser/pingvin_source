import { Button, Center, Stack, Text, Title } from "@mantine/core";
import Link from "next/link";
import { ReactNode } from "react";
import { FormattedMessage } from "react-intl";
import useHomeHref from "../../hooks/homeHref.hook";

/**
 * Full-page fallback for pages that cannot load their share/reverse-share
 * record. Without it the edit and reverse-share upload routes keep rendering
 * an empty form after the failed request, which invites edits that can never
 * be saved.
 */
const ShareLoadError = ({
  title,
  description,
}: {
  title: ReactNode;
  description: ReactNode;
}) => {
  const homeHref = useHomeHref();

  return (
    <Center style={{ minHeight: "60vh" }}>
      <Stack align="center" spacing="md">
        <Title order={1} size="h3">
          {title}
        </Title>
        <Text color="dimmed" align="center">
          {description}
        </Text>
        <Button component={Link} href={homeHref}>
          <FormattedMessage id="common.button.go-home" />
        </Button>
      </Stack>
    </Center>
  );
};

export default ShareLoadError;
