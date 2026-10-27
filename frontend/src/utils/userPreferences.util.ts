const defaultPreferences = [
  {
    key: "colorScheme",
    value: "system",
  },
  {
    key: "locale",
    value: "system",
  },
];

// Storage can be blocked (private mode, enterprise policy) and its value can be
// corrupted by another tab or an older build. Neither may break hydration.
const readPreferences = (): Record<string, string> => {
  try {
    const parsed = JSON.parse(localStorage.getItem("preferences") ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
};

const get = (key: string) => {
  if (typeof window !== "undefined") {
    const preferences = readPreferences();
    return (
      preferences[key] ??
      defaultPreferences.find((p) => p.key == key)?.value ??
      null
    );
  }
};

const set = (key: string, value: string) => {
  if (typeof window !== "undefined") {
    const preferences = readPreferences();
    preferences[key] = value;
    try {
      localStorage.setItem("preferences", JSON.stringify(preferences));
    } catch {
      // A full or blocked storage keeps the in-memory theme for this page.
    }
  }
};
const userPreferences = {
  get,
  set,
};

export default userPreferences;
