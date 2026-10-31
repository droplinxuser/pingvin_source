import {
  Inject,
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  OnModuleInit,
} from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { LocalFileService } from "./local.service";
import { S3FileService } from "./s3.service";
import { ConfigService } from "src/config/config.service";
import { spawn } from "child_process";
import * as crypto from "crypto";
import { Dirent, createWriteStream } from "fs";
import { promises as fs } from "fs";
import { join } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { PrismaService } from "../prisma/prisma.service";
import { EmailService } from "src/email/email.service";
import { I18nService } from "nestjs-i18n";
import { TrendingService } from "src/cache/trending.service";
import { SearchService } from "src/cache/search.service";
import { VirusTotalQueueService } from "src/virustotal/virustotalQueue.service";
import {
  getCachedValue,
  invalidateShareDataCache,
  setCachedValue,
} from "src/utils/cache.util";
import { getFileMimeType } from "src/utils/mime.util";
import { byteToHumanSizeString } from "src/utils/fileSize.util";
import { getPreviewCandidates, PreviewFile } from "src/share/preview.util";
import { isShareExpired, sumFileSizes } from "src/share/share.util";
import {
  RemoteFetchError,
  downloadRemoteToFile,
} from "src/utils/remoteFetch.util";
import {
  FileHostError,
  detectFileHost,
  resolveFileHost,
} from "src/utils/fileHosts.util";
import {
  MediaDownloadError,
  detectMediaHost,
  downloadMediaWithYtDlp,
  isYtDlpAvailable,
} from "src/utils/mediaHosts.util";
import { getFfmpegCandidates } from "src/utils/dependencies.util";
import { removeVirusTotalResult } from "src/virustotal/virustotalReport.util";
import { SAFE_FILE_NAME } from "./dto/upload.dto";
import { DATA_DIRECTORY, SHARE_DIRECTORY } from "src/constants";
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
const PREVIEW_MISS_TTL_MS = 10 * 60 * 1000;
// One share-level thumbnail is used by every listing (trending, new, share
// page/widget and 404 widget) and by the share's OG metadata. Keeping it
// separate from the per-file gallery preview means a video share never has to
// load the video itself into a listing card.
const THUMBNAIL_ROOT = `${DATA_DIRECTORY}/uploads/_thumbnails`;
const THUMBNAIL_VERSION = "v300";
const THUMBNAIL_DIRECTORY = `${THUMBNAIL_ROOT}/${THUMBNAIL_VERSION}`;
const THUMBNAIL_MAX_AGE_MS = 32 * 24 * 60 * 60 * 1000;
const THUMBNAIL_CONCURRENCY = 3;
const THUMBNAIL_WARM_LIMIT = 48;
// A public share id is enough to request a thumbnail, so keep the pending
// conversion queue bounded instead of letting scrapers stack ffmpeg/sharp work.
const THUMBNAIL_QUEUE_LIMIT = 200;
// Per-file WebP previews need their own queue: share thumbnails call this
// helper while they occupy a thumbnail slot, so sharing one queue would
// deadlock once every slot waits for a preview task that can never start.
const PREVIEW_CONCURRENCY = 3;
const PREVIEW_QUEUE_LIMIT = 200;
// Reject decompression-bomb images well below sharp's default limit.
const PREVIEW_MAX_INPUT_PIXELS = 64_000_000;
const THUMBNAIL_TIMEOUT_MS = 20_000;
const WEBP_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/tiff",
  "image/avif",
]);
const SAFE_ID = /^[\w=-]+$/;

type ShareThumbnail = { path: string; size: number; mtimeMs: number };

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
    private readonly search: SearchService,
    private readonly virusTotalQueue: VirusTotalQueueService,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}
  private readonly logger = new Logger(FileService.name);
  private readonly previewBuilds = new Map<
    string,
    Promise<{ path: string; size: number } | undefined>
  >();
  private readonly previewMisses = new Map<string, number>();
  private readonly lastShareTouch = new Map<string, number>();
  private readonly thumbnailBuilds = new Map<
    string,
    Promise<ShareThumbnail | undefined>
  >();
  private readonly thumbnailMisses = new Map<string, number>();
  private readonly thumbnailFailures = new Map<string, string>();
  private readonly thumbnailQueue: Array<() => void> = [];
  private thumbnailActive = 0;
  private lastThumbnailWarmAt = 0;
  private thumbnailPlaceholder?: Promise<Buffer>;
  private readonly previewQueue: Array<() => void> = [];
  private previewActive = 0;

  async onModuleInit() {
    await this.removeOldPreviewVersions(PREVIEW_ROOT, PREVIEW_VERSION);
    await this.removeOldPreviewVersions(THUMBNAIL_ROOT, THUMBNAIL_VERSION);
    // Clear stale derivatives on boot as well as in the daily cron.
    void this.cleanupShareThumbnails().catch(() => {});
  }

  private async removeOldPreviewVersions(root: string, current: string) {
    // These directories are derived caches. Drop versions from older
    // dimensions so the current rollout does not leave large files behind.
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      await Promise.all(
        entries
          .filter((entry) => entry.isDirectory() && entry.name !== current)
          .map((entry) =>
            fs.rm(join(root, entry.name), {
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
    const result = await storageService.create(data, chunk, file, shareId);
    // A legacy archive.zip is a snapshot. It must never keep serving a file
    // that was removed or an older version of the share after an upload. The
    // first chunk is enough: later chunks cannot recreate the archive, so
    // avoid one failed unlink per chunk of a large upload.
    if (chunk.index === 0) await this.removeLocalZip(shareId);
    return result;
  }

  /**
   * Downloads a remote http(s) URL and stores it as a file in the share. The
   * download runs server-side with SSRF protections (see remoteFetch.util) and
   * the bytes are fed through the normal chunked `create` path, so quota,
   * size limits, in-flight accounting and the local/S3 storage split all apply.
   */
  async createFromUrl(
    shareId: string,
    url: string,
    name?: string,
    options: { rejectHtml?: boolean } = {},
  ) {
    const fileId = crypto.randomUUID();
    const directory = `${SHARE_DIRECTORY}/${shareId}`;
    await fs.mkdir(directory, { recursive: true });
    const tempPath = `${directory}/${fileId}.remote`;

    const maxFileSize =
      parseInt(this.configService.get("share.maxFileSize")) || 0;

    let result;
    try {
      result = await downloadRemoteToFile(url, tempPath, {
        maxBytes: maxFileSize > 0 ? maxFileSize : undefined,
      });
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      throw this.toRemoteFetchException(error, maxFileSize);
    }

    try {
      // A file host that answers with an HTML page (login wall, virus-scan
      // confirmation, expired link) did not give us the file; reject it rather
      // than storing the page as the downloaded "file".
      if (options.rejectHtml && /text\/html/i.test(result.contentType ?? ""))
        throw new FileHostError("resolve", "file host returned an HTML page");

      const finalName = this.sanitizeRemoteFileName(
        name || result.fileName || fileNameFromUrl(result.finalUrl),
      );
      await this.storeChunkedFile(
        shareId,
        fileId,
        tempPath,
        result.size,
        finalName,
      );
      return { id: fileId, name: finalName };
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  /**
   * Imports files from a supported file-host page (Bunkr, MediaFire). Direct
   * file URLs are downloaded by the visitor's browser, so the server endpoint
   * only accepts allowlisted hosts: the server never fetches an arbitrary URL,
   * which keeps its SSRF surface as small as possible. Every resolved direct
   * URL still goes through the SSRF-guarded downloader.
   */
  async importFromUrl(shareId: string, url: string, name?: string) {
    // A host is imported either by a page resolver (file hosts) or by the
    // yt-dlp media extractor. Anything else stays browser-only: the server
    // never fetches an arbitrary URL, which keeps its SSRF surface minimal.
    const fileHost = detectFileHost(url);
    const mediaHost = fileHost ? null : detectMediaHost(url);
    if (!fileHost && !mediaHost)
      throw new BadRequestException(
        this.i18n.t("file.remoteHostResolveFailed"),
      );

    // Fail before downloading when the share is already completed. The storage
    // layer re-checks on every chunk, so a direct createFromUrl caller stays
    // guarded without this lookup repeating once per resolved file.
    const share = await this.prisma.share.findFirst({
      where: { id: shareId },
      select: { uploadLocked: true },
    });
    if (share?.uploadLocked)
      throw new BadRequestException(this.i18n.t("file.alreadyCompleted"));

    if (mediaHost) return this.importMediaFromUrl(shareId, url, name);

    let targets: { url: string; name?: string }[];
    try {
      targets = await resolveFileHost(url);
    } catch (error) {
      throw this.toFileHostException(error);
    }

    const files = [];
    for (const target of targets) {
      // A resolved host name (real filename) wins over the client-derived one.
      try {
        files.push(
          await this.createFromUrl(shareId, target.url, target.name ?? name, {
            rejectHtml: true,
          }),
        );
      } catch (error) {
        if (error instanceof FileHostError)
          throw this.toFileHostException(error);
        throw error;
      }
    }
    return { files };
  }

  /**
   * Imports a single media item (video/audio) from an allowlisted platform via
   * yt-dlp. yt-dlp writes the file into a per-file temp directory next to the
   * share; the bytes are then fed through the same chunk pipeline as every
   * other upload, so quota, size limits and the scan hooks all still apply.
   */
  private async importMediaFromUrl(
    shareId: string,
    url: string,
    name?: string,
  ) {
    if (!this.configService.get("share.enableMediaImport"))
      throw new BadRequestException(this.i18n.t("file.mediaImportDisabled"));
    if (!(await isYtDlpAvailable()))
      throw new BadRequestException(this.i18n.t("file.mediaImportUnavailable"));

    const maxFileSize =
      parseInt(this.configService.get("share.maxFileSize")) || 0;
    const fileId = crypto.randomUUID();
    const directory = `${SHARE_DIRECTORY}/${shareId}`;
    await fs.mkdir(directory, { recursive: true });
    const tempDir = `${directory}/${fileId}.media`;

    try {
      // Only the extractor failure is remapped; errors from the chunk pipeline
      // (share size, quota) keep their specific message.
      const download = await downloadMediaWithYtDlp(url, tempDir, {
        maxBytes: maxFileSize > 0 ? maxFileSize : undefined,
      }).catch((error) => {
        throw this.toMediaException(error, maxFileSize);
      });
      // The extractor's title-derived name is more useful than the page slug.
      const finalName = this.sanitizeRemoteFileName(
        download.name || name || "media",
      );
      await this.storeChunkedFile(
        shareId,
        fileId,
        download.path,
        download.size,
        finalName,
      );
      return { id: fileId, name: finalName };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Splits a local file into chunks and feeds them through `create()`. */
  private async storeChunkedFile(
    shareId: string,
    fileId: string,
    sourcePath: string,
    size: number,
    finalName: string,
  ) {
    const chunkSize =
      parseInt(this.configService.get("share.chunkSize")) || 10_000_000;
    const total = Math.max(1, Math.ceil(size / chunkSize));

    const handle = await fs.open(sourcePath, "r");
    try {
      for (let index = 0; index < total; index++) {
        const length = Math.min(chunkSize, size - index * chunkSize);
        const buffer = Buffer.alloc(Math.max(length, 0));
        if (length > 0) {
          // `read` is allowed to return fewer bytes than requested. Fill the
          // whole chunk, otherwise an imported file would gain zero padding.
          let read = 0;
          while (read < length) {
            const result = await handle.read(
              buffer,
              read,
              length - read,
              index * chunkSize + read,
            );
            if (result.bytesRead === 0) break;
            read += result.bytesRead;
          }
          if (read !== length)
            throw new Error(
              `Short read while importing ${shareId}/${fileId}: ${read}/${length}`,
            );
        }
        await this.create(
          buffer.toString("base64"),
          { index, total },
          { id: fileId, name: finalName },
          shareId,
        );
      }
    } finally {
      await handle.close();
    }
  }

  private toMediaException(error: unknown, maxFileSize: number) {
    const maxSize = byteToHumanSizeString(maxFileSize);
    if (error instanceof MediaDownloadError) {
      if (error.reason === "too_large")
        return new BadRequestException(
          this.i18n.t("file.remoteFetchTooLarge", { args: { maxSize } }),
        );
      if (error.reason === "timeout")
        return new BadRequestException(this.i18n.t("file.mediaImportTimeout"));
      if (error.reason === "unavailable")
        return new BadRequestException(
          this.i18n.t("file.mediaImportUnavailable"),
        );
      this.logger.debug(`Media import failed: ${error.message}`);
    }
    return new BadRequestException(this.i18n.t("file.mediaImportFailed"));
  }

  private toFileHostException(error: unknown) {
    if (error instanceof FileHostError) {
      if (error.code === "gofile")
        return new BadRequestException(
          this.i18n.t("file.remoteGofileUnsupported"),
        );
      if (error.code === "folder")
        return new BadRequestException(
          this.i18n.t("file.remoteHostFolderUnsupported"),
        );
      if (error.code === "unsupported")
        return new BadRequestException(
          this.i18n.t("file.remoteHostUnsupported"),
        );
      return new BadRequestException(
        this.i18n.t("file.remoteHostResolveFailed"),
      );
    }
    this.logger.debug(`File-host resolve failed: ${error}`);
    return new BadRequestException(this.i18n.t("file.remoteHostResolveFailed"));
  }

  private toRemoteFetchException(error: unknown, maxFileSize: number) {
    const reason = error instanceof RemoteFetchError ? error.reason : undefined;
    const maxSize = byteToHumanSizeString(maxFileSize);
    if (reason === "too_large")
      return new BadRequestException(
        this.i18n.t("file.remoteFetchTooLarge", { args: { maxSize } }),
      );
    if (reason === "timeout")
      return new BadRequestException(this.i18n.t("file.remoteFetchTimeout"));
    if (reason === "too_many_redirects")
      return new BadRequestException(
        this.i18n.t("file.remoteFetchTooManyRedirects"),
      );
    if (reason === "blocked" || reason === "invalid")
      return new BadRequestException(this.i18n.t("file.remoteFetchBlocked"));
    this.logger.debug(`Remote fetch failed: ${error}`);
    return new BadRequestException(this.i18n.t("file.remoteFetchFailed"));
  }

  private sanitizeRemoteFileName(name: string): string {
    const trimmed = name.split(/[\\/]/).pop()?.trim() || "";
    // eslint-disable-next-line no-control-regex
    const safe = trimmed.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 1024);
    if (safe && SAFE_FILE_NAME.test(safe)) return safe;
    const fallback = safe.replace(/[\\/:*?"<>|]/g, "_") || "download";
    return fallback.slice(0, 1024);
  }

  /** Removes the legacy local ZIP snapshot for a share, if one exists. */
  async removeLocalZip(shareId: string) {
    if (!SAFE_ID.test(shareId)) return;
    await fs
      .rm(join(SHARE_DIRECTORY, shareId, "archive.zip"), { force: true })
      .catch(() => undefined);
  }

  private async touchShare(shareId: string) {
    const now = Date.now();
    // Chunks arrive in quick succession. Remember the last write in this
    // process so a large upload costs one UPDATE instead of one SELECT per
    // chunk (the database timestamp still throttles across restarts).
    if (now - (this.lastShareTouch.get(shareId) ?? 0) < UPDATED_AT_THROTTLE_MS)
      return;

    if (this.lastShareTouch.size > 1000) {
      for (const [id, touchedAt] of this.lastShareTouch) {
        if (now - touchedAt >= UPDATED_AT_THROTTLE_MS)
          this.lastShareTouch.delete(id);
      }
    }
    this.lastShareTouch.set(shareId, now);

    await this.prisma.share.updateMany({
      where: { id: shareId },
      data: { updatedAt: new Date() },
    });
  }

  async createPreSignedUploadUrls(
    shareId: string,
    fileName: string,
    totalChunks: number,
  ) {
    // Do not sign an arbitrary number of URLs: the client cannot need more
    // chunks than the configured per-file limit allows.
    const chunkSize =
      parseInt(this.configService.get("share.chunkSize")) || 10_000_000;
    const maxFileSize =
      parseInt(this.configService.get("share.maxFileSize")) || 0;
    const maxChunks =
      maxFileSize > 0 ? Math.ceil(maxFileSize / chunkSize) : 10_000;
    if (totalChunks > Math.min(maxChunks, 10_000)) {
      throw new BadRequestException(this.i18n.t("file.tooManyChunks"));
    }

    const share = await this.prisma.share.findFirst({
      where: { id: shareId },
      select: { storageProvider: true, uploadLocked: true },
    });
    if (share?.uploadLocked)
      throw new BadRequestException(this.i18n.t("file.alreadyCompleted"));
    if (share?.storageProvider !== "S3") {
      return { directToS3: false };
    }
    await this.touchShare(shareId);
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
    const share = await this.prisma.share.findFirst({
      where: { id: shareId },
      select: { storageProvider: true, uploadLocked: true },
    });
    if (share?.uploadLocked)
      throw new BadRequestException(this.i18n.t("file.alreadyCompleted"));
    if (share?.storageProvider !== "S3") {
      throw new BadRequestException(this.i18n.t("file.s3NotSupported"));
    }
    await this.touchShare(shareId);
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
      select: { storageProvider: true, uploadLocked: true },
    });
    if (share?.uploadLocked)
      throw new BadRequestException(this.i18n.t("file.alreadyCompleted"));
    if (share?.storageProvider !== "S3") {
      throw new BadRequestException(this.i18n.t("file.s3NotSupported"));
    }
    return this.s3FileService.abortPreSignedUpload(shareId, fileName, uploadId);
  }

  async getPreSignedDownloadUrl(
    shareId: string,
    fileId: string,
    isDownload: boolean,
    storageProvider?: string,
  ): Promise<string> {
    // The caller usually already has the provider from the security guard.
    const provider =
      storageProvider ??
      (
        await this.prisma.share.findFirst({
          where: { id: shareId },
          select: { storageProvider: true },
        })
      )?.storageProvider;
    if (provider !== "S3") {
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
    const missedAt = this.previewMisses.get(buildKey);
    if (missedAt) {
      if (Date.now() - missedAt < PREVIEW_MISS_TTL_MS) return undefined;
      this.previewMisses.delete(buildKey);
    }

    const running = this.previewBuilds.get(buildKey);
    if (running) return running;

    // Route image previews through their own bounded queue. Share thumbnails
    // call this from the thumbnail queue, so reusing that queue would deadlock.
    if (this.previewQueue.length >= PREVIEW_QUEUE_LIMIT) {
      this.previewMisses.set(buildKey, Date.now());
      return undefined;
    }

    const build = this.enqueuePreview(() =>
      this.buildWebpPreview(
        shareId,
        fileId,
        storageProvider,
        shareDirectory,
        previewPath,
      ),
    )
      .then((result) => {
        if (result) {
          this.previewMisses.delete(buildKey);
        } else {
          this.previewMisses.set(buildKey, Date.now());
          if (this.previewMisses.size > 1000) {
            const oldest = this.previewMisses.keys().next().value;
            if (oldest) this.previewMisses.delete(oldest);
          }
        }
        return result;
      })
      .finally(() => {
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
    let original: File | undefined;

    try {
      // Check the type and size before opening a local file descriptor or an
      // S3 response body; unsupported gallery images return here on every
      // request without leaking a stream.
      const file = await this.prisma.file.findFirst({
        where: { id: fileId, shareId },
        select: { name: true, size: true },
      });
      if (
        !file ||
        !WEBP_IMAGE_TYPES.has(getFileMimeType(file.name, false)) ||
        parseInt(file.size, 10) > PREVIEW_MAX_FILE_SIZE
      )
        return undefined;

      original = await this.get(shareId, fileId, undefined, storageProvider);
      await fs.mkdir(shareDirectory, { recursive: true });
      await pipeline(
        original.file,
        sharp({ limitInputPixels: PREVIEW_MAX_INPUT_PIXELS })
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
      original?.file?.destroy();
      await fs.rm(tempPath, { force: true }).catch(() => {});
      this.logger.debug(
        `Could not build WebP preview for ${shareId}/${fileId}: ${error}`,
      );
      return undefined;
    }
  }

  private getShareThumbnailPath(shareId: string): string | undefined {
    if (!SAFE_ID.test(shareId)) return undefined;
    return join(THUMBNAIL_DIRECTORY, `${shareId}.webp`);
  }

  /**
   * A transparent 1x1 WebP used only when a share media source cannot produce
   * a thumbnail. It keeps the card's dark background/text intact without a
   * browser 404, and is served with no-store so a later successful build is
   * picked up immediately.
   */
  getThumbnailFailureReason(shareId: string): string {
    return this.thumbnailFailures.get(shareId) ?? "unavailable";
  }

  async getThumbnailPlaceholder(): Promise<Buffer> {
    if (!this.thumbnailPlaceholder) {
      this.thumbnailPlaceholder = sharp({
        create: {
          width: 1,
          height: 1,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .webp()
        .toBuffer();
    }
    return this.thumbnailPlaceholder;
  }

  async hasShareThumbnail(shareId: string): Promise<boolean> {
    const path = this.getShareThumbnailPath(shareId);
    if (!path) return false;
    try {
      await fs.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns the single share-level thumbnail. If it is missing (a legacy
   * share, a warmed listing item, or a thumbnail deleted by cleanup), the
   * caller waits for one build. Listings and OG requests share the same
   * in-flight promise, so a burst of card requests runs one ffmpeg/sharp job
   * per share instead of one per card.
   */
  async getShareThumbnail(
    shareId: string,
  ): Promise<ShareThumbnail | undefined> {
    const path = this.getShareThumbnailPath(shareId);
    if (!path) return undefined;

    try {
      const stat = await fs.stat(path);
      return { path, size: stat.size, mtimeMs: stat.mtimeMs };
    } catch {
      // Not generated yet.
    }

    return this.ensureShareThumbnail(shareId);
  }

  /**
   * Fire-and-forget warmup used after a listing API read. The frontend will
   * request the thumbnails immediately afterwards; this just starts the work
   * before those requests arrive.
   */
  async warmShareThumbnails(shareIds: string[]): Promise<void> {
    if (shareIds.length === 0) return;

    // The listing controllers call this on every response, but listings are
    // cached for 30 seconds. One directory scan per window is enough; a card
    // that misses later is still built on demand.
    const now = Date.now();
    if (now - this.lastThumbnailWarmAt < 30_000) return;
    this.lastThumbnailWarmAt = now;

    let existing = new Set<string>();
    try {
      existing = new Set(await fs.readdir(THUMBNAIL_DIRECTORY));
    } catch {
      // The directory is created on the first build.
    }

    // Only the first two listing batches are warmed. The rest are generated
    // on demand as the visitor scrolls, keeping a 200-card page from starting
    // hundreds of ffmpeg jobs at once.
    for (const shareId of shareIds.slice(0, THUMBNAIL_WARM_LIMIT)) {
      if (!existing.has(`${shareId}.webp`))
        void this.ensureShareThumbnail(shareId).catch(() => {});
    }
  }

  /** Queues a thumbnail after upload completion or as a backfill. */
  scheduleShareThumbnail(shareId: string): void {
    void this.ensureShareThumbnail(shareId).catch(() => {});
  }

  async removeShareThumbnail(shareId: string): Promise<void> {
    const path = this.getShareThumbnailPath(shareId);
    if (!path) return;

    // Let an in-flight build finish so it cannot recreate the file after the
    // delete. This is rare (edits/deletes while the card is loading).
    const running = this.thumbnailBuilds.get(shareId);
    if (running) await running.catch(() => {});
    this.thumbnailBuilds.delete(shareId);
    this.thumbnailMisses.delete(shareId);
    await fs.rm(path, { force: true }).catch(() => {});
  }

  /** Deletes thumbnails that have not been generated/refreshed in 32 days. */
  async cleanupShareThumbnails(): Promise<number> {
    const cutoff = Date.now() - THUMBNAIL_MAX_AGE_MS;
    let deleted = 0;
    let entries: Dirent[] | undefined;

    try {
      entries = await fs.readdir(THUMBNAIL_DIRECTORY, { withFileTypes: true });
    } catch {
      return 0;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".webp")) continue;
      const path = join(THUMBNAIL_DIRECTORY, entry.name);
      try {
        const stat = await fs.stat(path);
        if (stat.mtimeMs < cutoff) {
          await fs.rm(path, { force: true });
          deleted += 1;
        }
      } catch {
        // Another cleanup/process may already have removed it.
      }
    }

    if (deleted > 0)
      this.logger.log(`Deleted ${deleted} expired share thumbnails`);
    return deleted;
  }

  private async ensureShareThumbnail(
    shareId: string,
  ): Promise<ShareThumbnail | undefined> {
    const path = this.getShareThumbnailPath(shareId);
    if (!path) return undefined;

    try {
      const stat = await fs.stat(path);
      return { path, size: stat.size, mtimeMs: stat.mtimeMs };
    } catch {
      // Not generated yet.
    }

    const missedAt = this.thumbnailMisses.get(shareId);
    if (missedAt) {
      if (Date.now() - missedAt < PREVIEW_MISS_TTL_MS) return undefined;
      this.thumbnailMisses.delete(shareId);
    }

    const running = this.thumbnailBuilds.get(shareId);
    if (running) return running;

    if (this.thumbnailQueue.length >= THUMBNAIL_QUEUE_LIMIT) {
      this.rememberThumbnailFailure(shareId, "queue-full");
      return undefined;
    }

    const build = this.enqueueThumbnail(() =>
      this.buildShareThumbnail(shareId, path),
    )
      .then((result) => {
        if (result) {
          this.thumbnailMisses.delete(shareId);
        } else {
          this.thumbnailMisses.set(shareId, Date.now());
          if (this.thumbnailMisses.size > 1000) {
            const oldest = this.thumbnailMisses.keys().next().value;
            if (oldest) this.thumbnailMisses.delete(oldest);
          }
        }
        return result;
      })
      .finally(() => {
        if (this.thumbnailBuilds.get(shareId) === build)
          this.thumbnailBuilds.delete(shareId);
      });

    this.thumbnailBuilds.set(shareId, build);
    return build;
  }

  private enqueueThumbnail<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.thumbnailQueue.push(() => {
        this.thumbnailActive += 1;
        task()
          .then(resolve, reject)
          .finally(() => {
            this.thumbnailActive -= 1;
            this.processThumbnailQueue();
          });
      });
      this.processThumbnailQueue();
    });
  }

  private processThumbnailQueue(): void {
    while (
      this.thumbnailActive < THUMBNAIL_CONCURRENCY &&
      this.thumbnailQueue.length > 0
    ) {
      this.thumbnailQueue.shift()?.();
    }
  }

  private enqueuePreview<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.previewQueue.push(() => {
        this.previewActive += 1;
        task()
          .then(resolve, reject)
          .finally(() => {
            this.previewActive -= 1;
            this.processPreviewQueue();
          });
      });
      this.processPreviewQueue();
    });
  }

  private processPreviewQueue(): void {
    while (
      this.previewActive < PREVIEW_CONCURRENCY &&
      this.previewQueue.length > 0
    ) {
      this.previewQueue.shift()?.();
    }
  }

  private async buildShareThumbnail(
    shareId: string,
    thumbnailPath: string,
  ): Promise<ShareThumbnail | undefined> {
    this.thumbnailFailures.delete(shareId);
    const share = await this.prisma.share.findUnique({
      where: { id: shareId },
      select: {
        id: true,
        uploadLocked: true,
        removedReason: true,
        expiration: true,
        storageProvider: true,
        files: {
          select: { id: true, name: true, size: true },
          orderBy: { name: "asc" },
        },
      },
    });

    if (!share || !share.uploadLocked || share.removedReason) {
      this.rememberThumbnailFailure(shareId, "unavailable");
      return undefined;
    }
    if (isShareExpired(share.expiration)) {
      this.rememberThumbnailFailure(shareId, "expired");
      return undefined;
    }

    const candidates = getPreviewCandidates(share.files);
    if (candidates.length === 0) {
      this.rememberThumbnailFailure(shareId, "no-media");
      return undefined;
    }

    try {
      await fs.mkdir(THUMBNAIL_DIRECTORY, { recursive: true });
    } catch {
      this.rememberThumbnailFailure(shareId, "unavailable");
      return undefined;
    }

    let failureReason = "unavailable";
    for (const preview of candidates) {
      const tempPath = `${thumbnailPath}.${process.pid}.${Math.random()
        .toString(36)
        .slice(2)}.tmp`;

      try {
        await this.renderThumbnailCandidate(share, preview, tempPath);

        await fs.rename(tempPath, thumbnailPath);
        // Hardlinks inherit the source inode's mtime. Refresh it so the
        // 32-day cleanup measures when this share thumbnail was built, not
        // when the per-file gallery preview happened to be created.
        const builtAt = new Date();
        await fs.utimes(thumbnailPath, builtAt, builtAt);
        const stat = await fs.stat(thumbnailPath);
        return {
          path: thumbnailPath,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        };
      } catch (error) {
        await fs.rm(tempPath, { force: true }).catch(() => {});
        const reason = (error as { thumbnailReason?: string }).thumbnailReason;
        failureReason =
          reason ??
          (preview.kind === "video" ? "video-failed" : "image-failed");
        this.logger.debug(
          `Could not build share thumbnail for ${shareId} from ${preview.id}: ${error}`,
        );
      }
    }

    this.rememberThumbnailFailure(shareId, failureReason);
    return undefined;
  }

  /**
   * Keeps the diagnostic reason for the placeholder header without letting a
   * long-lived process accumulate one entry per share that has no thumbnail.
   */
  private rememberThumbnailFailure(shareId: string, reason: string) {
    this.thumbnailFailures.delete(shareId);
    this.thumbnailFailures.set(shareId, reason);
    if (this.thumbnailFailures.size > 1000) {
      const oldest = this.thumbnailFailures.keys().next().value;
      if (oldest) this.thumbnailFailures.delete(oldest);
    }
  }

  /**
   * Renders one preview candidate into a temporary WebP. Images reuse the
   * gallery's per-file preview; videos extract a frame. The caller retries
   * another candidate when this throws, so one corrupt upload cannot blank a
   * listing card.
   */
  private async renderThumbnailCandidate(
    share: {
      id: string;
      storageProvider: string;
      files: { id: string; name: string; size: string }[];
    },
    preview: PreviewFile,
    tempPath: string,
  ): Promise<void> {
    if (preview.kind === "image") {
      const filePreview = await this.getWebpPreview(
        share.id,
        preview.id,
        share.storageProvider,
      );
      if (!filePreview)
        throw Object.assign(new Error("image-preview-unavailable"), {
          thumbnailReason: "image-failed",
        });

      // Hardlink the per-file WebP when possible. The gallery and listing then
      // share the same inode instead of storing two copies.
      try {
        await fs.link(filePreview.path, tempPath);
      } catch {
        await fs.copyFile(filePreview.path, tempPath);
      }
      return;
    }

    const framePath = `${tempPath}.png`;
    try {
      const sourceFile = share.files.find((file) => file.id === preview.id);
      const formatHint = getVideoFormatHint(sourceFile?.name);

      if (share.storageProvider === "S3") {
        const source = await this.s3FileService.getPreSignedDownloadUrl(
          share.id,
          preview.id,
          false,
        );
        await this.extractVideoFrame(source, framePath, formatHint);
      } else {
        const localSource = join(SHARE_DIRECTORY, share.id, preview.id);
        const appUrl = this.configService.get("general.appUrl");
        const base = appUrl?.replace(/\/+$/, "");
        const publicSource = base
          ? `${base}/api/shares/${share.id}/files/${preview.id}?download=false`
          : undefined;
        const publicHeaders = base
          ? `Referer: ${base}/\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36\r\n`
          : undefined;

        let localError: unknown;
        try {
          await fs.stat(localSource);
          await this.extractVideoFrame(localSource, framePath, formatHint);
        } catch (error) {
          localError = error;
        }

        if (localError !== undefined) {
          // A disk restore can leave the DB row and edge cache intact while
          // the origin bytes are missing or damaged. Retry the extraction
          // against the public edge copy.
          if (!publicSource) {
            throw Object.assign(new Error("video-local-failed"), {
              thumbnailReason: "video-local-failed",
            });
          }
          try {
            await this.extractVideoFrame(
              publicSource,
              framePath,
              formatHint,
              publicHeaders,
            );
          } catch (publicError) {
            const message = String(publicError);
            throw Object.assign(new Error(message), {
              thumbnailReason: /timed out/i.test(message)
                ? "video-timeout"
                : /\b(?:401|403|404)\b|HTTP/i.test(message)
                  ? "video-http-failed"
                  : "video-edge-failed",
            });
          }
        }
      }

      await sharp(framePath, {
        limitInputPixels: PREVIEW_MAX_INPUT_PIXELS,
      })
        .rotate()
        .resize({
          width: PREVIEW_MAX_DIMENSION,
          height: PREVIEW_MAX_DIMENSION,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: WEBP_QUALITY, effort: 4 })
        .toFile(tempPath);
    } finally {
      await fs.rm(framePath, { force: true }).catch(() => {});
    }
  }

  private async extractVideoFrame(
    input: string,
    output: string,
    formatHint?: string,
    httpHeaders?: string,
  ): Promise<void> {
    let lastError: unknown;
    const formatArgs = formatHint ? ["-f", formatHint] : [];
    const headerArgs = httpHeaders ? ["-headers", httpHeaders] : [];

    // MPEG-TS and some fragmented containers do not always honour an input
    // seek, and a decoder can emit warnings/errors while still writing a
    // perfectly good first frame. Try input seeks, an accurate output seek and
    // a plain first-frame decode, and trust a non-empty output even if ffmpeg
    // exited non-zero. Some builds also need the container format forced
    // because the stored file has no extension.
    const seekVariants = [
      ["-ss", "1", ...formatArgs, ...headerArgs, "-i", input],
      ["-ss", "0", ...formatArgs, ...headerArgs, "-i", input],
      [...formatArgs, ...headerArgs, "-i", input, "-ss", "1"],
      [...formatArgs, ...headerArgs, "-i", input],
    ];
    const outputArgs = [
      "-map",
      "0:v:0",
      "-frames:v",
      "1",
      "-an",
      "-f",
      "image2",
      "-vcodec",
      "png",
      "-y",
      output,
    ];

    for (const binary of getFfmpegCandidates()) {
      for (const inputArgs of seekVariants) {
        await fs.rm(output, { force: true }).catch(() => {});
        try {
          await runProcess(
            binary,
            [
              "-hide_banner",
              "-loglevel",
              "error",
              "-probesize",
              "10M",
              "-analyzeduration",
              "10M",
              ...inputArgs,
              ...outputArgs,
            ],
            THUMBNAIL_TIMEOUT_MS,
          );
        } catch (error) {
          lastError = error;
        }

        try {
          const stat = await fs.stat(output);
          if (stat.size > 0) return;
        } catch {
          // Try the next seek/candidate.
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("No video frame could be extracted");
  }

  private async removePreviewCache(shareId: string, fileId?: string) {
    if (!SAFE_ID.test(shareId)) return;
    // Let in-flight conversions finish first. Otherwise a preview that was
    // already being generated could recreate its file after this cleanup.
    await this.waitForPreviewBuilds(shareId, fileId);
    const target = fileId
      ? join(PREVIEW_DIRECTORY, shareId, `${fileId}.webp`)
      : join(PREVIEW_DIRECTORY, shareId);

    const prefix = `${shareId}:`;
    for (const key of this.previewMisses.keys()) {
      if (key === `${prefix}${fileId}` || (!fileId && key.startsWith(prefix)))
        this.previewMisses.delete(key);
    }

    await fs.rm(target, { recursive: !fileId, force: true }).catch(() => {});
  }

  private async waitForPreviewBuilds(shareId: string, fileId?: string) {
    const prefix = `${shareId}:`;
    const keys = [...this.previewBuilds.keys()].filter((key) =>
      fileId ? key === `${prefix}${fileId}` : key.startsWith(prefix),
    );
    const builds = keys.flatMap((key) => {
      const build = this.previewBuilds.get(key);
      return build ? [build.catch(() => undefined)] : [];
    });
    await Promise.all(builds);
    keys.forEach((key) => this.previewBuilds.delete(key));
  }

  async exists(shareId: string, fileId: string): Promise<boolean> {
    const file = await this.prisma.file.findFirst({
      where: { id: fileId, shareId },
      select: { id: true },
    });
    return !!file;
  }

  async remove(shareId: string, fileId: string) {
    // Cancel any queued scan before removing the bytes so the worker cannot
    // spend an API call on a file that no longer exists.
    await this.virusTotalQueue.removeForFile(shareId, fileId);

    const share = await this.prisma.share.findFirst({
      where: { id: shareId },
      select: { storageProvider: true },
    });
    const storageService = this.getStorageService(share?.storageProvider);
    await storageService.remove(shareId, fileId);
    // Bump the share's update time first: it is the version in thumbnail
    // URLs, so a listing that repopulates after the invalidation below must
    // already use the new thumbnail URL.
    await this.prisma.share
      .update({ where: { id: shareId }, data: { updatedAt: new Date() } })
      .catch(() => {});
    await Promise.all([
      this.removePreviewCache(shareId, fileId),
      this.removeShareThumbnail(shareId),
      this.removeLocalZip(shareId),
      invalidateShareDataCache(this.cache, shareId),
      this.trending.invalidate(shareId),
      this.search.invalidate(),
      removeVirusTotalResult(shareId, fileId),
    ]);
  }

  /** Releases in-flight bytes after the daily cleanup removes a temp chunk. */
  releaseTempBytes(shareId: string, bytes: number) {
    this.localFileService.releaseTempBytes(shareId, bytes);
  }

  async deleteAllFiles(shareId: string, invalidateCaches = true) {
    await this.virusTotalQueue.removeForShare(shareId);
    const share = await this.prisma.share.findFirst({
      where: { id: shareId },
      select: { id: true, storageProvider: true },
    });
    const storageService = this.getStorageService(share?.storageProvider);
    await storageService.deleteAllFiles(shareId);
    if (!invalidateCaches) {
      await Promise.all([
        this.removePreviewCache(shareId),
        this.removeShareThumbnail(shareId),
      ]);
      return;
    }
    await Promise.all([
      this.removePreviewCache(shareId),
      this.removeShareThumbnail(shareId),
      invalidateShareDataCache(this.cache, shareId),
      this.trending.invalidate(shareId),
      this.search.invalidate(),
    ]);
  }

  /**
   * Streams a ZIP built on the fly from the share's current files. The archive
   * is never written to disk. A selection larger than `share.maxZipSize` is
   * rejected so one request cannot tie up the server or produce an uncacheable
   * stream; the client falls back to per-file downloads for larger sets.
   */
  async getZip(
    shareId: string,
    storageProvider?: string,
    fileIds?: string[],
  ): Promise<Readable> {
    const files = await this.prisma.file.findMany({
      where: { shareId, ...(fileIds ? { id: { in: fileIds } } : {}) },
      select: { id: true, name: true, size: true },
      orderBy: { name: "asc" },
    });
    if (files.length === 0)
      throw new NotFoundException(this.i18n.t("file.notFound"));

    const maxZipSize = parseInt(
      this.configService.get("share.maxZipSize") || "0",
      10,
    );
    if (maxZipSize > 0) {
      if (sumFileSizes(files) > maxZipSize)
        throw new PayloadTooLargeException(this.i18n.t("file.zipTooLarge"));
    }

    const provider =
      storageProvider ??
      (
        await this.prisma.share.findFirst({
          where: { id: shareId },
          select: { storageProvider: true },
        })
      )?.storageProvider;
    const storageService = this.getStorageService(provider);
    return await storageService.getZip(shareId, files);
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
      if (await getCachedValue<true>(this.cache, notificationKey)) return;

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

      await this.emailService.sendShareDownloadNotification(
        share.creator.email,
        share.id,
        fileName,
        recipient.email,
        share.creator?.displayName || share.creator?.username,
        recipientUser?.displayName || recipientUser?.username,
      );

      // Start the cooldown only after a successful send, so a transient SMTP
      // failure does not suppress the notification for fifteen minutes.
      await setCachedValue(
        this.cache,
        notificationKey,
        true,
        DOWNLOAD_NOTIFICATION_COOLDOWN_MS,
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

function fileNameFromUrl(url: string): string {
  try {
    const segment = new URL(url).pathname.split("/").filter(Boolean).pop();
    if (segment) return decodeURIComponent(segment);
  } catch {
    // Fall through to a generic name.
  }
  return "download";
}

function getVideoFormatHint(fileName?: string): string | undefined {
  const extension = fileName?.split(".").pop()?.toLowerCase();
  if (!extension) return undefined;

  if (extension === "ts" || extension === "mts" || extension === "m2ts")
    return "mpegts";
  if (["mp4", "m4v", "mov", "f4v"].includes(extension)) return "mov";
  if (extension === "webm") return "webm";
  if (extension === "mkv") return "matroska";
  if (extension === "avi") return "avi";
  if (extension === "flv") return "flv";
  if (extension === "wmv") return "asf";
  if (extension === "3gp") return "3gp";
  return undefined;
}

function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out`));
    }, timeoutMs);

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 2000) stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}: ${stderr}`));
    });
  });
}
