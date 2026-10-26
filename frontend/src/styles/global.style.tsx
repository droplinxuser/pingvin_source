import { Global } from "@mantine/core";

const GlobalStyle = () => {
  return (
    <Global
      styles={(theme) => ({
        a: {
          color: "inherit",
          textDecoration: "none",
        },
        "table.md, table.md th:nth-of-type(odd), table.md td:nth-of-type(odd)":
          {
            background:
              theme.colorScheme == "dark"
                ? "rgba(50, 50, 50, 0.5)"
                : "rgba(220, 220, 220, 0.5)",
          },
        "table.md td": {
          paddingLeft: "0.5em",
          paddingRight: "0.5em",
        },
        ".skip-link": {
          position: "absolute",
          left: -9999,
          top: 0,
          zIndex: 1000,
          padding: "8px 14px",
          borderRadius: theme.radius.sm,
          backgroundColor:
            theme.colorScheme === "dark" ? theme.white : theme.black,
          color: theme.colorScheme === "dark" ? theme.black : theme.white,
        },
        ".skip-link:focus": {
          left: theme.spacing.md,
          top: theme.spacing.md,
        },
        ".visually-hidden": {
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0, 0, 0, 0)",
          whiteSpace: "nowrap",
          border: 0,
        },
        "img, video": {
          maxWidth: "100%",
        },
        "@keyframes lazy-image-shimmer": {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        ".lazy-image": {
          backgroundColor:
            theme.colorScheme === "dark"
              ? theme.colors.dark[6]
              : theme.colors.gray[2],
          backgroundImage: `linear-gradient(90deg, transparent 0%, ${
            theme.colorScheme === "dark"
              ? "rgba(255, 255, 255, 0.08)"
              : "rgba(255, 255, 255, 0.55)"
          } 50%, transparent 100%)`,
          backgroundSize: "200% 100%",
          animation: "lazy-image-shimmer 1.4s linear infinite",
        },
        ".lazy-image-loaded": {
          backgroundColor: "transparent",
          backgroundImage: "none",
          animation: "none",
        },
        "a:focus-visible, button:focus-visible": {
          outline: `2px solid ${theme.colors[theme.primaryColor][6]}`,
          outlineOffset: 2,
        },
      })}
    />
  );
};
export default GlobalStyle;
