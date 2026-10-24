import {
  Inject,
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { LocalFileService } from "./local.service";
import { S3FileService } from "./s3.service";
import { ConfigService } from "src/config/config.service";
import { createWriteStream } from "fs";
import { promises as fs } from "fs";
import { join } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { PrismaService } from "../prisma/prisma.service";
import { EmailService } from "src/email/email.service";
import { I18nService } from "nestjs-i18n";
import { TrendingService } from "src/cache/trending.service";
import { invalidateShareDataCache } from "src/utils/cache.util";
import { getFileMimeType } from "src/utils/mime.util";
import { DATA_DIRECTORY } from "src/constants";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require("sharp");

const UPDATED_AT_THROTTLE_MS = 5 * 60 * 1000;
const DOWNLOAD_NOTIFICATION_COOLDOWN_MS = 15 * 60 * 1000;
const PREVIEW_ROOT = `${DATA_DIRECTORY}/uploads/_previews`;
const PREVIEW_VERSION = "v300";
const PREVIEW_DIRECTORY = `${PREVIEW_ROOT}/${PREVIEW_VERSION}`;
const PREVIEW_MAX_FILE_SIZE = 100 * 1024 * 1024;
// Gallery/trending thumbnails are 150-250px tall; 300px covers them on
// high-density displays without generating 1600px WebP caches.
const PREVIEW_MAX_DIMENSION = 300;
const WEBP_QUALITY = 82;
const WEBP_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/bmp",
  "image/tiff",
  "image/avif",
]);
const SAFE_ID = /^[\w=-]+$/;

@Injectable()
export class FileService implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private localFileService: LocalFileService,
    private s3FileService: S3FileService,
    private configService: ConfigService,
    private emailService: EmailService,
    private readonly i18n: I18nService,
    private readonly trending: TrendingService,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}
  private readonly logger = new Logger(FileService.name);
  private readonly previewBuilds = new Map<
    string,
    Promise<{ path: string; size: number } | undefined>
  >();

  async onModuleInit() {
    // Preview files are a derived cache. Drop caches from older dimensions so
    // the 300px rollout does not leave large WebP files behind.
    try {
      const entries = await fs.readdir(PREVIEW_ROOT, { withFileTypes: true });
      await Promise.all(
        entries
          .filter(
            (entry) => entry.isDirectory() && entry.name !== PREVIEW_VERSION,
          )
          .map((entry) =>
            fs.rm(join(PREVIEW_ROOT, entry.name), {
              recursive: true,
              force: true,
            }),
          ),
      );
    } catch {
      // Cache directory does not exist yet.
    }
  }

  // Determine which service to use based on the current config value
  // shareId is optional -> can be used to overwrite a storage provider
  private getStorageService(
    storageProvider?: string,
  ): S3FileService | LocalFileService {
    if (storageProvider != undefined)
      return storageProvider == "S3"
        ? this.s3FileService
        : this.localFileService;
    return this.configService.get("s3.enabled")
      ? this.s3FileService
      : this.localFileService;
  }

  async create(
    data: string,
    chunk: { index: number; total: number },
    file: {
      id?: string;
      name: string;
    },
    shareId: string,
  ) {
    await this.touchShare(shareId);
    const storageService = this.getStorageService();
    return storageService.create(data, chunk, file, shareId);
  }

  private async touchShare(shareId: string) {
    const share = await this.prisma.share.findUnique({
      where: { id: shareId },
      select: { updatedAt: true },
    });
    if (!share) return;
    if (
      share.updatedAt &&
      Date.now() - share.updatedAt.getTime() < UPDATED_AT_THROTTLE_MS
    )
      return;
    await this.prisma.share.update({
      where: { id: shareId },
      data: { updatedAt: new Date() },
    });
  }

  async createPreSignedUploadUrls(
    shareId: string,
    fileName: string,
    totalChunks: number,
  ) {
    await this.touchShare(shareId);
    const share = await this.prisma.share.findFirst({
      where: { id: shareId },
      select: { storageProvider: true },
    });
    if (share?.storageProvider !== "S3") {
      return { directToS3: false };
    }
    const res = await this.s3FileService.createPreSignedUploadUrls(
      shareId,
      fileName,
      totalChunks,
    );
    return { directToS3: true, ...res };
  }

  async completePreSignedUpload(
    shareId: string,
    fileId: string,
    fileName: string,
    uploadId: string,
    parts: Array<{ ETag: string; PartNumber: number }>,
  ) {
    await this.touchShare(shareId);
    const share = await this.prisma.share.findFirst({
      where: { id: shareId },
      select: { storageProvider: true },
    });
    if (share?.storageProvider !== "S3") {
      throw new BadRequestException(this.i18n.t("file.s3NotSupported"));
    }
    return this.s3FileService.completePreSignedUpload(
      shareId,
      fileId,
      fileName,
      uploadId,
      parts,
    );
  }

  async abortPreSignedUpload(
    shareId: string,
    fileName: string,
    uploadId: string,
  ) {
    const share = await this.prisma.share.findFirst({
      where: { id: shareId },
      select: { storageProvider: true },
    });
    if (share?.storageProvider !== "S3") {
      throw new BadRequestException(this.i18n.t("file.s3NotSupported"));
    }
    return this.s3FileService.abortPreSignedUpload(shareId, fileName, uploadId);
  }

  async getPreSignedDownloadUrl(
    shareId: string,
    fileId: string,
    isDownload: boolean,
  ): Promise<string> {
    const share = await this.prisma.share.findFirst({
      where: { id: shareId },
      select: { storageProvider: true },
    });
    if (share?.storageProvider !== "S3") {
      throw new BadRequestException(this.i18n.t("file.s3NotSupported"));
    }
    return this.s3FileService.getPreSignedDownloadUrl(
      shareId,
      fileId,
      isDownload,
    );
  }

  async get(
    shareId: string,
    fileId: string,
    range?: { start: number; end?: number } | string,
    storageProvider?: string,
  ): Promise<File> {
    const provider =
      storageProvider ??
      (
        await this.prisma.share.findFirst({
          where: { id: shareId },
          select: { storageProvider: true },
        })
      )?.storageProvider;
    const storageService = this.getStorageService(provider);
    return storageService.get(shareId, fileId, range);
  }

  /**
   * Returns a resized WebP preview for a raster image. Previews are generated
   * once into a private disk cache; downloads keep the original file.
   */
  async getWebpPreview(
    shareId: string,
    fileId: string,
    storageProvider?: string,
  ): Promise<{ path: string; size: number } | undefined> {
    if (!SAFE_ID.test(shareId) || !SAFE_ID.test(fileId)) return undefined;

    const shareDirectory = join(PREVIEW_DIRECTORY, shareId);
    const previewPath = join(shareDirectory, `${fileId}.webp`);
    try {
      const cached = await fs.stat(previewPath);
      return { path: previewPath, size: cached.size };
    } catch {
      // Not generated yet.
    }

    const buildKey = `${shareId}:${fileId}`;
    const running = this.previewBuilds.get(buildKey);
    if (running) return running;

    const build = this.buildWebpPreview(
      shareId,
      fileId,
      storageProvider,
      shareDirectory,
      previewPath,
    ).finally(() => {
      if (this.previewBuilds.get(buildKey) === build)
        this.previewBuilds.delete(buildKey);
    });
    this.previewBuilds.set(buildKey, build);
    return build;
  }

  private async buildWebpPreview(
    shareId: string,
    fileId: string,
    storageProvider: string | undefined,
    shareDirectory: string,
    previewPath: string,
  ): Promise<{ path: string; size: number } | undefined> {
    const tempPath = `${previewPath}.${process.pid}.${Math.random()
      .toString(36)
      .slice(2)}.tmp`;

    try {
      const original = await this.get(
        shareId,
        fileId,
        undefined,
        storageProvider,
      );
      const mimeType = getFileMimeType(original.metaData.name, false);
      if (
        !WEBP_IMAGE_TYPES.has(mimeType) ||
        parseInt(original.metaData.size, 10) > PREVIEW_MAX_FILE_SIZE
      )
        return undefined;

      await fs.mkdir(shareDirectory, { recursive: true });
      await pipeline(
        original.file,
        sharp()
          .rotate()
          .resize({
            width: PREVIEW_MAX_DIMENSION,
            height: PREVIEW_MAX_DIMENSION,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: WEBP_QUALITY, effort: 4 }),
        createWriteStream(tempPath),
      );
      await fs.rename(tempPath, previewPath);
      const stat = await fs.stat(previewPath);
      return { path: previewPath, size: stat.size };
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      this.logger.debug(
        `Could not build WebP preview for ${shareId}/${fileId}: ${error}`,
      );
      return undefined;
    }
  }

  private async removePreviewCache(shareId: string, fileId?: string) {
    if (!SAFE_ID.test(shareId)) return;
    const target = fileId
      ? join(PREVIEW_DIRECTORY, shareId, `${fileId}.webp`)
      : join(PREVIEW_DIRECTORY, shareId);

    await fs.rm(target, { recursive: !fileId, force: true }).catch(() => {});
  }

  async remove(shareId: string, fileId: string) {
    const share = await this.prisma.share.findFirst({
      where: { id: shareId },
      select: { storageProvider: true },
    });
    const storageService = this.getStorageService(share?.storageProvider);
    await storageService.remove(shareId, fileId);
    await Promise.all([
      this.removePreviewCache(shareId, fileId),
      invalidateShareDataCache(this.cache, shareId),
      this.trending.invalidate(shareId),
    ]);
  }

  async deleteAllFiles(shareId: string) {
    const share = await this.prisma.share.findFirst({
      where: { id: shareId },
      select: { id: true, storageProvider: true },
    });
    const storageService = this.getStorageService(share?.storageProvider);
    await storageService.deleteAllFiles(shareId);
    await Promise.all([
      this.removePreviewCache(shareId),
      invalidateShareDataCache(this.cache, shareId),
      this.trending.invalidate(shareId),
    ]);
  }

  async getZip(shareId: string, storageProvider?: string): Promise<Readable> {
    const provider =
      storageProvider ??
      (
        await this.prisma.share.findFirst({
          where: { id: shareId },
          select: { storageProvider: true },
        })
      )?.storageProvider;
    const storageService = this.getStorageService(provider);
    return await storageService.getZip(shareId);
  }

  async notifyRecipientDownload(
    shareId: string,
    fileName: string,
    recipientId?: string,
  ) {
    try {
      if (
        !recipientId ||
        !this.configService.get("smtp.enabled") ||
        !this.configService.get("share.enableShareEmailRecipients") ||
        !this.configService.get("share.enableShareDownloadNotifications")
      )
        return;

      const notificationKey = `share-download-notification:${shareId}:${recipientId}`;
      if (await this.cache.get<true>(notificationKey)) return;

      const share = await this.prisma.share.findUnique({
        where: { id: shareId },
        select: {
          id: true,
          creator: {
            select: { email: true, username: true, displayName: true },
          },
          recipients: {
            where: { id: recipientId },
            select: { email: true },
          },
        },
      });

      const recipient = share?.recipients[0];
      if (!share?.creator?.email || !recipient) return;

      const recipientUser = await this.prisma.user.findUnique({
        where: { email: recipient.email },
        select: { displayName: true, username: true },
      });

      await this.cache.set(
        notificationKey,
        true,
        DOWNLOAD_NOTIFICATION_COOLDOWN_MS,
      );

      await this.emailService.sendShareDownloadNotification(
        share.creator.email,
        share.id,
        fileName,
        recipient.email,
        share.creator?.displayName || share.creator?.username,
        recipientUser?.displayName || recipientUser?.username,
      );
    } catch (e) {
      this.logger.error(
        `Failed to notify recipient download for share ${shareId}`,
        e instanceof Error ? e.stack : String(e),
      );
    }
  }

  async getStorageProvider(shareId: string): Promise<string> {
    const share = await this.prisma.share.findFirst({
      where: { id: shareId },
      select: { storageProvider: true },
    });
    return share?.storageProvider || "LOCAL";
  }

  async getFileName(shareId: string, fileId: string): Promise<string> {
    const file = await this.prisma.file.findFirst({
      where: { id: fileId, shareId },
      select: { name: true },
    });
    if (!file) throw new NotFoundException(this.i18n.t("file.notFound"));
    return file.name;
  }

  private async streamToUint8Array(stream: Readable): Promise<Uint8Array> {
    const chunks: Buffer[] = [];

    return new Promise((resolve, reject) => {
      stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
      stream.on("error", reject);
    });
  }
}

export interface File {
  metaData: {
    id: string;
    size: string;
    createdAt: Date;
    mimeType: string | false;
    name: string;
    shareId: string;
  };
  file?: Readable;
  range?: { start: number; end: number };
  isRangeNotSatisfiable?: boolean;
}
