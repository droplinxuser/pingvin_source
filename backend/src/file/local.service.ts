import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import * as archiver from "archiver";
import * as crypto from "crypto";
import { createReadStream } from "fs";
import * as fs from "fs/promises";
import * as mime from "mime-types";
import { I18nService } from "nestjs-i18n";
import { resolve, sep } from "path";
import { ConfigService } from "src/config/config.service";
import { PrismaService } from "src/prisma/prisma.service";
import {
  resolveShareSizeLimit,
  shareWriteLock,
  sumFileSizes,
} from "src/share/share.util";
import { byteToHumanSizeString } from "src/utils/fileSize.util";
import { getUserActiveStorageUsage } from "src/utils/storageQuota.util";
import { validate as isValidUUID } from "uuid";
import { SHARE_DIRECTORY } from "../constants";
import { Readable } from "stream";
import * as rangeParser from "range-parser";
import { SAFE_FILE_NAME } from "./dto/upload.dto";
import { File } from "./file.service";

@Injectable()
export class LocalFileService {
  private readonly logger = new Logger(LocalFileService.name);
  // Bytes appended by uploads that have not produced a File row yet. Without
  // this, several parallel files can each pass the share/account quota check
  // while together exceeding it. The maps are bounded and process-local; the
  // completion check in ShareService is the final backstop.
  private readonly pendingShareBytes = new Map<string, number>();
  private readonly pendingUserBytes = new Map<string, number>();
  // Which account owns the in-flight bytes of each share, so deleting a share
  // or an abandoned temp file can release the same user quota it reserved.
  private readonly pendingShareOwner = new Map<string, string>();

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private readonly i18n: I18nService,
  ) {}

  async create(
    data: string,
    chunk: { index: number; total: number },
    file: { id?: string; name: string },
    shareId: string,
  ) {
    // ShareService.complete() takes the same lock, so a completion can never
    // snapshot the file list while a chunk is being appended or published.
    return shareWriteLock.run(shareId, () =>
      this.createChunk(data, chunk, file, shareId),
    );
  }

  private async createChunk(
    data: string,
    chunk: { index: number; total: number },
    file: { id?: string; name: string },
    shareId: string,
  ) {
    if (
      typeof file.name !== "string" ||
      file.name.length > 1024 ||
      !SAFE_FILE_NAME.test(file.name)
    ) {
      throw new BadRequestException(this.i18n.t("file.invalidFileName"));
    }

    if (!file.id) {
      file.id = crypto.randomUUID();
    } else if (!isValidUUID(file.id)) {
      throw new BadRequestException(this.i18n.t("file.invalidIdFormat"));
    }

    // Chunk uploads only need the sizes and quota limits. Selecting whole rows
    // (including every File column) on each chunk is unnecessary.
    const share = await this.prisma.share.findUnique({
      where: { id: shareId },
      select: {
        uploadLocked: true,
        creatorId: true,
        files: { select: { size: true } },
        reverseShare: {
          select: {
            creatorId: true,
            maxShareSize: true,
            creator: { select: { storageQuotaLimit: true } },
          },
        },
        creator: {
          select: { storageQuotaLimit: true, shareSizeLimit: true },
        },
      },
    });

    // The share can be deleted between the owner guard and the chunk write
    // (for example an expiry cleanup). Return the same 404 as a missing share
    // instead of dereferencing null.
    if (!share) throw new NotFoundException(this.i18n.t("share.notFound"));
    if (share.uploadLocked)
      throw new BadRequestException(this.i18n.t("file.alreadyCompleted"));

    let diskFileSize: number;
    try {
      diskFileSize = (
        await fs.stat(`${SHARE_DIRECTORY}/${shareId}/${file.id}.tmp-chunk`)
      ).size;
    } catch {
      diskFileSize = 0;
    }

    // If the sent chunk index and the expected chunk index doesn't match throw an error
    const chunkSize = this.config.get("share.chunkSize");
    const expectedChunkIndex = Math.ceil(diskFileSize / chunkSize);

    if (expectedChunkIndex != chunk.index)
      throw new BadRequestException({
        message: this.i18n.t("file.unexpectedChunk"),
        error: "unexpected_chunk_index",
        expectedChunkIndex,
      });

    const buffer = Buffer.from(data, "base64");

    // Check if there is enough space on the server
    const space = await fs.statfs(SHARE_DIRECTORY);
    const availableSpace = space.bavail * space.bsize;
    if (availableSpace < buffer.byteLength) {
      throw new InternalServerErrorException(
        this.i18n.t("file.notEnoughSpace"),
      );
    }

    const quotaOwner = share.reverseShare
      ? share.reverseShare.creator
      : share.creator;
    const quotaOwnerId = share.reverseShare
      ? share.reverseShare.creatorId
      : share.creatorId;

    // Pending bytes already include this file's earlier chunks. On a process
    // restart the map is empty, so fall back to the chunk already on disk.
    const pendingShare = this.pendingShareBytes.get(shareId) ?? diskFileSize;
    const pendingUser = quotaOwnerId
      ? (this.pendingUserBytes.get(quotaOwnerId) ?? diskFileSize)
      : 0;

    // Each file must fit the edge cache limit, while the whole share has its
    // own (larger) quota.
    const maxFileSize = parseInt(this.config.get("share.maxFileSize"));
    const uploadedFileSize = diskFileSize + buffer.byteLength;
    if (maxFileSize > 0 && uploadedFileSize > maxFileSize) {
      throw new HttpException(
        this.i18n.t("file.maxFileSizeExceeded", {
          args: { maxSize: byteToHumanSizeString(maxFileSize) },
        }),
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    const shareSizeSum =
      sumFileSizes(share.files) + pendingShare + buffer.byteLength;
    const limit = resolveShareSizeLimit(
      parseInt(this.config.get("share.maxSize")),
      share,
    );

    if (shareSizeSum > limit) {
      throw new HttpException(
        this.i18n.t("file.maxSizeExceeded"),
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    if (quotaOwnerId && quotaOwner?.storageQuotaLimit) {
      const quotaLimit = parseInt(quotaOwner.storageQuotaLimit);
      const activeStorageUsage = await getUserActiveStorageUsage(
        this.prisma,
        quotaOwnerId,
      );
      const projectedUsage =
        activeStorageUsage + pendingUser + buffer.byteLength;

      if (projectedUsage > quotaLimit) {
        const exceededBytes = projectedUsage - quotaLimit;
        const exceededSize = byteToHumanSizeString(exceededBytes);
        throw new HttpException(
          share.reverseShare
            ? this.i18n.t("file.reverseShareQuotaExceeded", {
                args: { exceededSize },
              })
            : this.i18n.t("file.storageQuotaExceeded", {
                args: { exceededSize },
              }),
          HttpStatus.PAYLOAD_TOO_LARGE,
        );
      }
    }

    await fs.appendFile(
      `${SHARE_DIRECTORY}/${shareId}/${file.id}.tmp-chunk`,
      buffer,
    );
    this.reservePendingBytes(
      shareId,
      quotaOwnerId,
      pendingShare,
      pendingUser,
      buffer.byteLength,
    );

    const isLastChunk = chunk.index == chunk.total - 1;
    if (isLastChunk) {
      await fs.rename(
        `${SHARE_DIRECTORY}/${shareId}/${file.id}.tmp-chunk`,
        `${SHARE_DIRECTORY}/${shareId}/${file.id}`,
      );
      const fileSize = (
        await fs.stat(`${SHARE_DIRECTORY}/${shareId}/${file.id}`)
      ).size;
      await this.prisma.file.create({
        data: {
          id: file.id,
          name: file.name,
          size: fileSize.toString(),
          share: { connect: { id: shareId } },
        },
      });
      // The bytes are now counted by the File row.
      this.releasePendingBytes(shareId, quotaOwnerId, fileSize);
    }

    return file;
  }

  private reservePendingBytes(
    shareId: string,
    userId: string | null | undefined,
    pendingShare: number,
    pendingUser: number,
    bytes: number,
  ) {
    if (this.pendingShareBytes.size > 5000) {
      this.pendingShareBytes.clear();
      this.pendingShareOwner.clear();
    }
    if (this.pendingUserBytes.size > 5000) this.pendingUserBytes.clear();
    this.pendingShareBytes.set(shareId, pendingShare + bytes);
    if (userId) {
      this.pendingShareOwner.set(shareId, userId);
      this.pendingUserBytes.set(userId, pendingUser + bytes);
    }
  }

  private releasePendingBytes(
    shareId: string,
    userId: string | null | undefined,
    fileSize: number,
  ) {
    // Read the current map instead of a value captured before the async write:
    // another file may have reserved bytes in the meantime.
    this.pendingShareBytes.set(
      shareId,
      Math.max(0, (this.pendingShareBytes.get(shareId) ?? 0) - fileSize),
    );
    if (userId)
      this.pendingUserBytes.set(
        userId,
        Math.max(0, (this.pendingUserBytes.get(userId) ?? 0) - fileSize),
      );
  }

  async get(
    shareId: string,
    fileId: string,
    range?: { start: number; end?: number } | string,
  ): Promise<File> {
    const fileMetaData = await this.prisma.file.findFirst({
      where: { id: fileId, shareId },
    });

    if (!fileMetaData)
      throw new NotFoundException(this.i18n.t("file.notFound"));

    const totalSize = parseInt(fileMetaData.size, 10);
    let activeRange: { start: number; end: number } | undefined;
    let isRangeNotSatisfiable = false;

    if (typeof range === "string") {
      const ranges = rangeParser(totalSize, range, { combine: true });
      if (ranges === -1) {
        isRangeNotSatisfiable = true;
      } else if (Array.isArray(ranges) && ranges.length > 0 && totalSize > 0) {
        activeRange = ranges[0];
      }
    } else if (range && typeof range === "object") {
      activeRange = {
        start: range.start,
        end: range.end ?? totalSize - 1,
      };
    }

    const filePath = this.getSafeFilePath(shareId, fileId);

    // A database row can outlive its bytes after a partial cleanup or disk
    // repair. Return a normal 404 instead of letting createReadStream emit an
    // unhandled error that takes the whole backend down.
    try {
      await fs.stat(filePath);
    } catch {
      throw new NotFoundException(this.i18n.t("file.notFound"));
    }

    const file = isRangeNotSatisfiable
      ? undefined
      : createReadStream(
          filePath,
          activeRange
            ? { start: activeRange.start, end: activeRange.end }
            : undefined,
        );

    return {
      metaData: {
        mimeType: mime.contentType(fileMetaData.name.split(".").pop()),
        ...fileMetaData,
        size: fileMetaData.size,
      },
      file,
      range: activeRange,
      isRangeNotSatisfiable,
    };
  }

  async remove(shareId: string, fileId: string) {
    const fileMetaData = await this.prisma.file.findFirst({
      where: { id: fileId, shareId },
    });

    if (!fileMetaData)
      throw new NotFoundException(this.i18n.t("file.notFound"));

    const filePath = this.getSafeFilePath(shareId, fileId);
    // Deleting an already missing byte file should still remove its stale row;
    // a database row can outlive the bytes after a partial cleanup/disk repair.
    await fs.rm(filePath, { force: true });

    await this.prisma.file.delete({ where: { id: fileId } });
  }

  private getSafeFilePath(shareId: string, fileId: string): string {
    const baseDir = resolve(SHARE_DIRECTORY, shareId);
    const resolvedPath = resolve(baseDir, fileId);

    if (!resolvedPath.startsWith(baseDir + sep)) {
      throw new BadRequestException(this.i18n.t("file.invalidIdFormat"));
    }

    return resolvedPath;
  }

  async deleteAllFiles(shareId: string) {
    const pending = this.pendingShareBytes.get(shareId) ?? 0;
    const owner = this.pendingShareOwner.get(shareId);
    this.pendingShareBytes.delete(shareId);
    this.pendingShareOwner.delete(shareId);
    if (pending > 0 && owner)
      this.pendingUserBytes.set(
        owner,
        Math.max(0, (this.pendingUserBytes.get(owner) ?? 0) - pending),
      );

    await fs.rm(`${SHARE_DIRECTORY}/${shareId}`, {
      recursive: true,
      force: true,
    });
  }

  /**
   * Releases the in-flight bytes of an abandoned temp chunk (called by the
   * daily cleanup) so a client that drops halfway through an upload cannot
   * keep another account's quota reduced until the backend restarts.
   */
  releaseTempBytes(shareId: string, bytes: number) {
    if (bytes <= 0) return;
    const remaining = Math.max(
      0,
      (this.pendingShareBytes.get(shareId) ?? 0) - bytes,
    );
    if (remaining > 0) {
      this.pendingShareBytes.set(shareId, remaining);
    } else {
      this.pendingShareBytes.delete(shareId);
    }

    const owner = this.pendingShareOwner.get(shareId);
    if (owner) {
      const userRemaining = Math.max(
        0,
        (this.pendingUserBytes.get(owner) ?? 0) - bytes,
      );
      if (userRemaining > 0) this.pendingUserBytes.set(owner, userRemaining);
      else this.pendingUserBytes.delete(owner);
    }
    if (remaining === 0) this.pendingShareOwner.delete(shareId);
  }

  /**
   * Streams the given files into a ZIP archive without ever writing it to disk.
   * `archiver` reads each file lazily, so memory stays flat even for a large
   * selection; the caller caps the total size before calling this.
   */
  async getZip(
    shareId: string,
    files: { id: string; name: string }[],
  ): Promise<Readable> {
    const archive = archiver("zip", {
      zlib: { level: parseInt(this.config.get("share.zipCompressionLevel")) },
    });
    archive.on("error", (err) => this.logger.error("Archive error", err));

    // A File row can outlive its bytes (partial cleanup/disk repair). Check the
    // files in parallel and skip the missing ones instead of letting a single
    // entry fail the whole archive.
    const present = await Promise.all(
      files.map(async (file) => {
        try {
          await fs.stat(this.getSafeFilePath(shareId, file.id));
          return file;
        } catch (error) {
          this.logger.warn(
            `Skipping missing file ${file.id} in ZIP for share ${shareId}: ${String(
              error,
            )}`,
          );
          return null;
        }
      }),
    );

    for (const file of present) {
      if (file)
        archive.file(this.getSafeFilePath(shareId, file.id), {
          name: file.name,
        });
    }

    void archive.finalize();
    return archive;
  }
}
