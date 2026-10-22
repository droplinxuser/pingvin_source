// One-time migration of legacy view counts from uploader.json to Share.views.
// Run with `npm run sync:views` (update.sh does this before restarting).
import "../src/constants";
import { PrismaClient } from "@prisma/client";
import {
  readUploaderInfo,
  writeUploaderInfo,
} from "../src/utils/uploaderInfo.util";

const prisma = new PrismaClient();

async function main() {
  const shares = await prisma.share.findMany({
    select: { id: true, views: true },
  });
  let synced = 0;

  for (const share of shares) {
    const info = await readUploaderInfo(share.id);
    if (typeof info?.views !== "number") continue;

    if (info.views > share.views) {
      await prisma.share.update({
        where: { id: share.id },
        data: { views: info.views },
      });
      synced++;
    }

    // Remove the legacy field so subsequent runs are no-ops.
    await writeUploaderInfo(share.id, { ...info, views: undefined });
  }

  console.log(`Synced legacy view counts for ${synced} share(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
