const compactFormats = new Map<string, Intl.NumberFormat>();

/**
 * Compact counters (`10.4K`, `1.2M`) are rendered in the footer and the
 * trending country tabs. Reusing one formatter per locale avoids rebuilding
 * `Intl.NumberFormat` in each component and keeps both surfaces consistent.
 */
export const getCompactNumberFormat = (locale: string): Intl.NumberFormat => {
  const cached = compactFormats.get(locale);
  if (cached) return cached;

  const format = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  compactFormats.set(locale, format);
  return format;
};
