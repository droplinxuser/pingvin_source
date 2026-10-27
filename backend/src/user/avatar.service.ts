import { BadRequestException, Injectable } from "@nestjs/common";
import { promises as fs } from "fs";
import { I18nService } from "nestjs-i18n";
import { join } from "path";
import { AVATAR_DIRECTORY } from "src/constants";
import { PrismaService } from "src/prisma/prisma.service";
import { writeFileAtomic } from "src/utils/fileWrite.util";
import { validate as isValidUUID } from "uuid";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require("sharp");

const MAX_INPUT_BYTES = 5 * 1024 * 1024;
// A small upload can still decode into a huge bitmap; cap the decoded pixels
// before sharp allocates anything.
const MAX_INPUT_PIXELS = 40_000_000;
const MAX_DIMENSION = 10_000;
const AVATAR_SIZE = 256;
const WEBP_OPTIONS = { quality: 82, effort: 4 };
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);

export type AvatarFile = {
  path: string;
  size: number;
  mtimeMs: number;
};

/**
 * Owns the on-disk profile picture. Every upload is decoded, centre-cropped to
 * a 256px square, stripped of metadata and re-encoded as WebP, so the stored
 * file is always a small raster image regardless of the uploaded format.
 */
@Injectable()
export class AvatarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
  ) {}

  private filePath(userId: string): string | null {
    return isValidUUID(userId)
      ? join(AVATAR_DIRECTORY, `${userId}.webp`)
      : null;
  }

  async get(userId: string): Promise<AvatarFile | null> {
    const path = this.filePath(userId);
    if (!path) return null;

    try {
      const stat = await fs.stat(path);
      return stat.isFile()
        ? { path, size: stat.size, mtimeMs: stat.mtimeMs }
        : null;
    } catch {
      return null;
    }
  }

  async save(userId: string, file: Buffer) {
    const path = this.filePath(userId);
    if (!path) throw new BadRequestException(this.i18n.t("auth.avatarInvalid"));

    if (!Buffer.isBuffer(file) || file.length === 0)
      throw new BadRequestException(this.i18n.t("auth.avatarInvalid"));
    if (file.length > MAX_INPUT_BYTES)
      throw new BadRequestException(this.i18n.t("auth.avatarTooLarge"));

    const metadata = await sharp(file, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: "error",
    })
      .metadata()
      .catch(() => null);

    if (
      !metadata?.format ||
      !ALLOWED_FORMATS.has(metadata.format) ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > MAX_DIMENSION ||
      metadata.height > MAX_DIMENSION
    )
      throw new BadRequestException(this.i18n.t("auth.avatarInvalid"));

    const webp = await sharp(file, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: "error",
    })
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "centre" })
      .webp(WEBP_OPTIONS)
      .toBuffer()
      .catch(() => null);

    if (!webp) throw new BadRequestException(this.i18n.t("auth.avatarInvalid"));

    await fs.mkdir(AVATAR_DIRECTORY, { recursive: true });
    const written = await writeFileAtomic(path, webp);
    if (!written)
      throw new BadRequestException(this.i18n.t("auth.avatarInvalid"));

    return this.prisma.user.update({
      where: { id: userId },
      data: { avatarUpdatedAt: new Date() },
    });
  }

  async remove(userId: string) {
    const path = this.filePath(userId);
    if (path) await fs.rm(path, { force: true });

    return this.prisma.user.update({
      where: { id: userId },
      data: { avatarUpdatedAt: null },
    });
  }

  /** Removes the file while deleting an account; there may be no avatar. */
  async deleteFile(userId: string) {
    const path = this.filePath(userId);
    if (path) await fs.rm(path, { force: true });
  }
}
