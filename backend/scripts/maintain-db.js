// Post-migration SQLite maintenance. Runs while the backend is stopped so the
// VACUUM has exclusive access. A failure is logged but must not block a deploy:
// the indexes and data are already correct without this compaction pass.
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

(async () => {
  try {
    await prisma.$executeRawUnsafe("VACUUM");
    console.log("SQLite VACUUM completed");
  } catch (error) {
    console.warn(`SQLite VACUUM skipped: ${error.message}`);
  } finally {
    await prisma.$disconnect();
  }
})();
