/**
 * SQLite storage metrics for the admin page. The values are read from PRAGMA
 * statements plus the on-disk file sizes, so the panel shows the real database
 * size and how much space a VACUUM could reclaim (free pages).
 */
export type DatabaseMetrics = {
  configured: boolean;
  // Absolute on-disk path reported by `PRAGMA database_list`.
  file: string | null;
  sizeBytes: number | null;
  walSizeBytes: number | null;
  shmSizeBytes: number | null;
  pageSize: number | null;
  pageCount: number | null;
  freePages: number | null;
  // Free pages / total pages. High values mean a VACUUM would shrink the file.
  fragmentation: number | null;
  journalMode: string | null;
  version: string | null;
  detail?: string;
};

export type DatabaseMetricsInput = Omit<
  DatabaseMetrics,
  "configured" | "fragmentation"
>;

export function buildDatabaseMetrics(
  input: DatabaseMetricsInput,
): DatabaseMetrics {
  const { pageCount, freePages } = input;
  const fragmentation =
    pageCount && pageCount > 0 && freePages != null
      ? freePages / pageCount
      : null;
  return { configured: true, fragmentation, ...input };
}

export function emptyDatabaseMetrics(detail?: string): DatabaseMetrics {
  return {
    configured: false,
    file: null,
    sizeBytes: null,
    walSizeBytes: null,
    shmSizeBytes: null,
    pageSize: null,
    pageCount: null,
    freePages: null,
    fragmentation: null,
    journalMode: null,
    version: null,
    detail,
  };
}
