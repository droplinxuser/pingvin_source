import { Box, Text, useMantineTheme } from "@mantine/core";
import Markdown, { MarkdownToJSX } from "markdown-to-jsx";
import { isMarkdownFile } from "../../utils/mime.util";

/**
 * Renders the body of a text file.
 *
 * Only Markdown files are parsed, and raw HTML stays disabled, so a share can
 * never inject markup into the page. Every other text file (logs, CSV, JSON,
 * source code) is printed verbatim in a monospace block so its line breaks and
 * indentation survive.
 */
const TextContent = ({
  text,
  fileName,
}: {
  text: string;
  fileName: string;
}) => {
  const { colorScheme } = useMantineTheme();

  if (!isMarkdownFile(fileName)) {
    return (
      <Text
        component="pre"
        sx={{
          margin: 0,
          fontFamily: "monospace",
          fontSize: "0.8125rem",
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {text}
      </Text>
    );
  }

  const options: MarkdownToJSX.Options = {
    disableParsingRawHTML: true,
    forceBlock: true,
    overrides: {
      // The page already owns the single <h1> (share title, legal page title),
      // so Markdown headings start one level lower. This keeps one H1 per
      // document and an outline that sits under the page title.
      h1: { component: "h2" },
      h2: { component: "h3" },
      h3: { component: "h4" },
      h4: { component: "h5" },
      h5: { component: "h6" },
      h6: { component: "h6" },
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
      // Markdown can embed remote images and links. Keep embedded images out of
      // the layout until they are scrolled to, never leak the share URL as a
      // referrer, and treat outbound links as untrusted user content.
      img: {
        props: {
          loading: "lazy",
          decoding: "async",
          referrerPolicy: "no-referrer",
          style: { maxWidth: "100%", height: "auto" },
        },
      },
      a: {
        props: {
          target: "_blank",
          rel: "noopener noreferrer nofollow",
        },
      },
    },
  };

  return (
    // Markdown headings inherit the page's type scale: a gist's H2 must not
    // outgrow the share title, and the first/last block should not add a gap
    // inside the preview card.
    <Box
      sx={{
        "& > :first-child": { marginTop: 0 },
        "& > :last-child": { marginBottom: 0 },
        "& h2": { fontSize: "1.25rem", lineHeight: 1.35 },
        "& h3": { fontSize: "1.1rem", lineHeight: 1.35 },
        "& h4, & h5, & h6": { fontSize: "1rem", lineHeight: 1.4 },
      }}
    >
      <Markdown options={options}>{text}</Markdown>
    </Box>
  );
};

export default TextContent;
