import { Anchor, Title, useMantineTheme } from "@mantine/core";
import Meta from "../../components/Meta";
import useTranslate from "../../hooks/useTranslate.hook";
import { FormattedMessage } from "react-intl";
import useConfig from "../../hooks/config.hook";
import useSiteMeta from "../../hooks/siteMeta.hook";
import { buildBreadcrumbList } from "../../utils/seo.util";
import Markdown from "markdown-to-jsx";

const Imprint = () => {
  const t = useTranslate();
  const { colorScheme } = useMantineTheme();
  const config = useConfig();
  const { siteName, baseUrl } = useSiteMeta();
  const jsonLd = buildBreadcrumbList(
    [
      { name: t("seo.custom.breadcrumb.home"), path: "/" },
      { name: t("imprint.title"), path: "/imprint" },
    ],
    baseUrl,
  );
  return (
    <article aria-labelledby="imprint-title">
      <Meta
        title={t("imprint.title")}
        description={t("seo.custom.imprint.description", { siteName })}
        canonicalPath="/imprint"
        jsonLd={jsonLd}
      />
      <Title id="imprint-title" mb={30} order={1}>
        <FormattedMessage id="imprint.title" />
      </Title>
      <Markdown
        options={{
          forceBlock: true,
          overrides: {
            pre: {
              props: {
                style: {
                  backgroundColor:
                    colorScheme == "dark"
                      ? "rgba(50, 50, 50, 0.5)"
                      : "rgba(220, 220, 220, 0.5)",
                  padding: "0.75em",
                  whiteSpace: "pre-wrap",
                },
              },
            },
            table: {
              props: {
                className: "md",
              },
            },
            a: {
              props: {
                target: "_blank",
                rel: "noreferrer",
              },
              component: Anchor,
            },
          },
        }}
      >
        {config.get("legal.imprintText")}
      </Markdown>
    </article>
  );
};

export default Imprint;
