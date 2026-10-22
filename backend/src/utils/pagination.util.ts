/**
 * Parses the page and pageSize query parameters of paginated admin endpoints.
 * Invalid values fall back to page 1 with a page size of 20; the page size is
 * capped at 100.
 */
export function parsePagination(page: string, pageSize: string) {
  const pageNum = Math.max(parseInt(page) || 1, 1);
  const size = Math.min(Math.max(parseInt(pageSize) || 20, 1), 100);
  return { page: pageNum, pageSize: size, skip: (pageNum - 1) * size };
}

/**
 * Maps the sortBy query parameter to a Prisma orderBy clause. Unknown fields
 * return undefined so the caller can use its default order.
 */
export function tableOrderBy<T extends string>(
  fields: Record<string, T>,
  sortBy?: string,
  sortDirection?: string,
): Record<T, "asc" | "desc"> | undefined {
  const field = sortBy ? fields[sortBy] : undefined;
  return field
    ? ({
        [field]: sortDirection === "asc" ? "asc" : "desc",
      } as Record<T, "asc" | "desc">)
    : undefined;
}
