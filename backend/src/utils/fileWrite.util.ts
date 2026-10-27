import { promises as fs } from "fs";
import { dirname } from "path";

type AtomicWriteOptions = {
  mode?: number;
  // Return `false` instead of throwing when the parent directory is gone (for
  // example after a share was deleted while a background write was queued).
  requireDirectory?: boolean;
};

/**
 * Writes a file through a unique temporary file and an atomic rename, so a
 * reader never sees a partial document and two writers cannot interleave.
 * Returns `false` only when `requireDirectory` is set and the directory is
 * missing; every other failure is rethrown after the temp file is removed.
 */
export async function writeFileAtomic(
  filePath: string,
  data: string | Buffer,
  { mode = 0o600, requireDirectory = false }: AtomicWriteOptions = {},
): Promise<boolean> {
  if (requireDirectory) {
    try {
      await fs.access(dirname(filePath));
    } catch {
      return false;
    }
  }

  const tempPath = `${filePath}.${process.pid}.${Math.random()
    .toString(36)
    .slice(2)}.tmp`;

  try {
    await fs.writeFile(tempPath, data, { encoding: "utf8", mode });
    await fs.rename(tempPath, filePath);
    return true;
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}
