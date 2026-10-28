import { MantineThemeOverride } from "@mantine/core";

export default <MantineThemeOverride>{
  colors: {
    // Mantine maps `Text color="dimmed"` to gray[6]. The stock #868e96 only
    // reaches 3.3:1 on white/gray[0], which fails WCAG AA for the small muted
    // labels used across the listings, footer and share tables. A slightly
    // darker step keeps the same visual hierarchy at 5.4:1.
    gray: [
      "#f8f9fa",
      "#f1f3f5",
      "#e9ecef",
      "#dee2e6",
      "#ced4da",
      "#adb5bd",
      "#5f6773",
      "#495057",
      "#343a40",
      "#212529",
    ],
    victoria: [
      "#E2E1F1",
      "#C2C0E7",
      "#A19DE4",
      "#7D76E8",
      "#544AF4",
      "#4940DE",
      "#4239C8",
      "#463FA8",
      "#47428E",
      "#464379",
    ],
  },
  primaryColor: "victoria",
  components: {
    Modal: {
      styles: (theme) => ({
        title: {
          fontSize: theme.fontSizes.lg,
          fontWeight: 700,
          maxWidth: "calc(100% - 40px)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        },
      }),
    },
  },
};
