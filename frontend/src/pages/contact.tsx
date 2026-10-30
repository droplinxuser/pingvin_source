import {
  Alert,
  Anchor,
  Button,
  Container,
  Paper,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { GetServerSidePropsContext } from "next";
import Link from "next/link";
import { useState } from "react";
import { FormattedMessage } from "react-intl";
import { TbAlertTriangle } from "react-icons/tb";
import Meta from "../components/Meta";
import TurnstileWidget from "../components/contact/TurnstileWidget";
import useHomeHref from "../hooks/homeHref.hook";
import useSiteMeta from "../hooks/siteMeta.hook";
import useTranslate from "../hooks/useTranslate.hook";
import contactService, { ContactConfig } from "../services/contact.service";
import {
  setListingCacheHeaders,
  setNoStoreHeaders,
} from "../utils/httpCache.util";
import { buildBreadcrumbList } from "../utils/seo.util";
import toast from "../utils/toast.util";

const EMPTY_CONFIG: ContactConfig = { enabled: false, siteKey: "" };

export async function getServerSideProps({
  req,
  res,
}: GetServerSidePropsContext) {
  const apiURL = process.env.API_URL || "http://localhost:8080";
  let config = EMPTY_CONFIG;
  let succeeded = false;
  try {
    const response = await fetch(`${apiURL}/api/contact/config`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1000),
    });
    if (response.ok) {
      config = (await response.json()) as ContactConfig;
      succeeded = true;
    }
  } catch {
    // The page shell can still render; the form stays unavailable until the
    // backend is reachable again.
  }

  // A transient backend failure must not be pinned at the edge as a disabled
  // contact form.
  if (succeeded) setListingCacheHeaders(req, res, true);
  else setNoStoreHeaders(res);
  return { props: { config } };
}

const Contact = ({ config }: { config: ContactConfig }) => {
  const t = useTranslate();
  const { siteName, baseUrl } = useSiteMeta();
  const homeHref = useHomeHref();
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [widgetKey, setWidgetKey] = useState(0);
  const form = useForm({
    initialValues: { name: "", email: "", subject: "", message: "" },
    validate: {
      name: (value) => (value.trim() ? null : t("contact.error.name-required")),
      email: (value) => {
        const email = value.trim();
        if (!email) return t("contact.error.email-required");
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
          ? null
          : t("contact.error.email-invalid");
      },
      subject: (value) =>
        value.trim() ? null : t("contact.error.subject-required"),
      message: (value) =>
        value.trim() ? null : t("contact.error.message-required"),
    },
  });

  const submit = form.onSubmit(async (values) => {
    if (!token) {
      toast.error(t("contact.captcha.required"));
      return;
    }
    setLoading(true);
    try {
      await contactService.send({
        name: values.name.trim(),
        email: values.email.trim(),
        subject: values.subject.trim(),
        message: values.message.trim(),
        turnstileToken: token,
      });
      form.reset();
      setToken("");
      setWidgetKey((key) => key + 1);
      toast.success(t("contact.success"));
    } catch (error) {
      toast.axiosError(error);
    } finally {
      setLoading(false);
    }
  });

  const jsonLd = buildBreadcrumbList(
    [
      { name: t("seo.custom.breadcrumb.home"), path: "/" },
      { name: t("contact.title"), path: "/contact" },
    ],
    baseUrl,
  );

  return (
    <Container size="sm">
      <Meta
        title={t("contact.title")}
        description={t("seo.custom.contact.description", { siteName })}
        canonicalPath="/contact"
        jsonLd={jsonLd}
      />
      <Title order={1} mb="xs">
        {t("contact.title")}
      </Title>
      <Text color="dimmed" mb="lg">
        {t("contact.description")}
      </Text>

      {config.enabled ? (
        <Paper withBorder radius="md" p="lg">
          <form onSubmit={submit}>
            <Stack>
              <TextInput
                label={t("contact.name")}
                placeholder={t("contact.name")}
                autoComplete="name"
                maxLength={100}
                required
                {...form.getInputProps("name")}
              />
              <TextInput
                label={t("contact.email")}
                placeholder={t("contact.email")}
                type="email"
                autoComplete="email"
                maxLength={254}
                required
                {...form.getInputProps("email")}
              />
              <TextInput
                label={t("contact.subject")}
                placeholder={t("contact.subject")}
                maxLength={160}
                required
                {...form.getInputProps("subject")}
              />
              <Textarea
                label={t("contact.message")}
                placeholder={t("contact.message")}
                autosize
                minRows={5}
                maxRows={14}
                maxLength={5000}
                required
                {...form.getInputProps("message")}
              />
              <div>
                <Text size="sm" weight={500} mb={5}>
                  {t("contact.captcha")}
                </Text>
                <TurnstileWidget
                  key={widgetKey}
                  siteKey={config.siteKey}
                  onVerify={setToken}
                />
              </div>
              <Button type="submit" loading={loading} disabled={!token}>
                {t("contact.submit")}
              </Button>
            </Stack>
          </form>
        </Paper>
      ) : (
        <Alert
          color="yellow"
          icon={<TbAlertTriangle />}
          title={t("contact.unavailable.title")}
        >
          <Text size="sm">{t("contact.unavailable.description")}</Text>
          <Anchor
            component={Link}
            href={homeHref}
            size="sm"
            mt="xs"
            display="inline-block"
          >
            <FormattedMessage id="common.button.go-home" />
          </Anchor>
        </Alert>
      )}
    </Container>
  );
};

export default Contact;
