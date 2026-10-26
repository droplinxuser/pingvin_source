import { Anchor, Title, useMantineTheme } from "@mantine/core";
import Markdown from "markdown-to-jsx";
import { FormattedMessage } from "react-intl";
import Meta from "../Meta";
import useSiteMeta from "../../hooks/siteMeta.hook";
import useTranslate from "../../hooks/useTranslate.hook";
import { buildBreadcrumbList } from "../../utils/seo.util";

/**
 * Shared layout for the configured imprint and privacy texts. Both pages only
 * differ by their title, metadata and markdown source.
 */
const LegalDocument = ({
  titleId,
  titleKey,
  descriptionKey,
  path,
  text,
}: {
  titleId: string;
  titleKey: string;
  descriptionKey: string;
  path: string;
  text?: string;
}) => {
  const t = useTranslate();
  const { colorScheme } = useMantineTheme();
  const { siteName, baseUrl } = useSiteMeta();
  const jsonLd = buildBreadcrumbList(
    [
      { name: t("seo.custom.breadcrumb.home"), path: "/" },
      { name: t(titleKey), path },
    ],
    baseUrl,
  );

  return (
    <article aria-labelledby={titleId}>
      <Meta
        title={t(titleKey)}
        description={t(descriptionKey, { siteName })}
        canonicalPath={path}
        jsonLd={jsonLd}
      />
      <Title id={titleId} mb={30} order={1}>
        <FormattedMessage id={titleKey} />
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
        {text ?? ""}
      </Markdown>
    </article>
  );
};

export default LegalDocument;
