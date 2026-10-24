import * as moment from "moment";
import { PrismaService } from "src/prisma/prisma.service";

/**
 * Sums the active storage used by a user. The previous version loaded every
 * file row and reduced them in JavaScript; this runs as one SQLite aggregate so
 * an upload chunk only transfers a single number.
 */
export async function getUserActiveStorageUsage(
  prisma: PrismaService,
  userId: string,
): Promise<number> {
  const rows = await prisma.$queryRaw<{ size: number | bigint | null }[]>`
    SELECT COALESCE(SUM(CAST(f."size" AS INTEGER)), 0) AS size
    FROM "File" f
    INNER JOIN "Share" s ON s."id" = f."shareId"
    LEFT JOIN "ReverseShare" r ON r."id" = s."reverseShareId"
    WHERE s."removedReason" IS NULL
      AND (s."expiration" > ${new Date()} OR s."expiration" = ${moment(0).toDate()})
      AND (
        (s."reverseShareId" IS NOT NULL AND r."creatorId" = ${userId})
        OR (s."reverseShareId" IS NULL AND s."creatorId" = ${userId})
      )
  `;

  return Number(rows[0]?.size ?? 0);
}
