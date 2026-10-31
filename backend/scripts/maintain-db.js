// Post-migration SQLite maintenance. Runs while the backend is stopped so the
// VACUUM has exclusive access. A failure is logged but must not block a deploy:
// the indexes and data are already correct without this compaction pass.
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const checkpoint = async () => {
  try {
    // Fold the write-ahead log back into the database before compaction. The
    // trailing checkpoint leaves an empty -wal file instead of one full of
    // freed pages. A busy/locked checkpoint must not skip the VACUUM below.
    await prisma.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch (error) {
    console.warn(`SQLite WAL checkpoint skipped: ${error.message}`);
  }
};

(async () => {
  await checkpoint();
  try {
    await prisma.$executeRawUnsafe("VACUUM");
    console.log("SQLite VACUUM completed");
  } catch (error) {
    console.warn(`SQLite VACUUM skipped: ${error.message}`);
  } finally {
    await checkpoint();
    await prisma.$disconnect();
  }
})();
