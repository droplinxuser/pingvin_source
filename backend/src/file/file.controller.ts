import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { SkipThrottle, Throttle } from "@nestjs/throttler";
import * as contentDisposition from "content-disposition";
import { createReadStream } from "fs";
import { Request, Response } from "express";
import { ConfigService } from "src/config/config.service";
import { StrictShareOwnerGuard } from "src/share/guard/strictShareOwner.guard";
import { IdValidation } from "src/share/guard/shareIdValidation.guard";
import {
  getDownloadCacheHeaders,
  getImageCacheHeaders,
  getZipCacheHeaders,
  isNotModified,
  NO_STORE_HEADERS,
} from "src/utils/cache.util";
import { getFileMimeType } from "src/utils/mime.util";
import { isRequestFromApp, redirectToSharePage } from "src/utils/referrer.util";
import {
  UploadAbortDTO,
  UploadCompleteDTO,
  UploadFromUrlDTO,
  UploadInitDTO,
} from "./dto/upload.dto";
import { FileService } from "./file.service";
import { FileSecurityGuard } from "./guard/fileSecurity.guard";

const VALID_ID_REGEX = /^[a-zA-Z0-9-]*={0,2}$/;

type FileRequest = Request & {
  shareIsPublic?: boolean;
  shareStorageProvider?: string;
  shareIsZipReady?: boolean;
};

function getValidRecipientId(recipientId?: string): string | undefined {
  if (!recipientId) return undefined;
  return VALID_ID_REGEX.test(recipientId) ? recipientId : undefined;
}

@Controller("shares/:shareId/files")
export class FileController {
  constructor(
    private fileService: FileService,
    private config: ConfigService,
  ) {}

  @Post("upload-init")
  @Throttle({
    default: { limit: 300, ttl: 60 * 1000 },
    visitor: { limit: 300, ttl: 60 * 1000 },
  })
  @UseGuards(IdValidation, StrictShareOwnerGuard)
  async uploadInit(
    @Body() body: UploadInitDTO,
    @Param("shareId") shareId: string,
  ) {
    return await this.fileService.createPreSignedUploadUrls(
      shareId,
      body.name,
      body.totalChunks,
    );
  }

  @Post("upload-complete")
  @Throttle({
    default: { limit: 300, ttl: 60 * 1000 },
    visitor: { limit: 300, ttl: 60 * 1000 },
  })
  @UseGuards(IdValidation, StrictShareOwnerGuard)
  async uploadComplete(
    @Body() body: UploadCompleteDTO,
    @Param("shareId") shareId: string,
  ) {
    return await this.fileService.completePreSignedUpload(
      shareId,
      body.id,
      body.name,
      body.uploadId,
      body.parts,
    );
  }

  @Post("upload-abort")
  @Throttle({
    default: { limit: 300, ttl: 60 * 1000 },
    visitor: { limit: 300, ttl: 60 * 1000 },
  })
  @UseGuards(IdValidation, StrictShareOwnerGuard)
  async uploadAbort(
    @Body() body: UploadAbortDTO,
    @Param("shareId") shareId: string,
  ) {
    await this.fileService.abortPreSignedUpload(
      shareId,
      body.name,
      body.uploadId,
    );
  }

  // Server-side import for supported file-host pages (MediaFire, Bunkr) whose
  // content cannot be read cross-origin. Direct file URLs are downloaded by the
  // visitor's browser instead, so this endpoint only accepts allowlisted hosts:
  // the server never fetches an arbitrary URL. Owner-only and rate-limited
  // because it consumes server bandwidth and disk.
  @Post("from-url")
  @Throttle({
    default: { limit: 30, ttl: 60 * 1000 },
    visitor: { limit: 15, ttl: 60 * 1000 },
  })
  @UseGuards(IdValidation, StrictShareOwnerGuard)
  async fromUrl(
    @Body() body: UploadFromUrlDTO,
    @Param("shareId") shareId: string,
  ) {
    return await this.fileService.importFromUrl(shareId, body.url, body.name);
  }

  @Post()
  // Large shares need many chunks, but an unbounded endpoint is a cheap disk
  // and CPU DoS. These limits still allow a 5 GB share at the default chunk
  // size to finish well within a minute.
  @Throttle({
    default: { limit: 1200, ttl: 60 * 1000 },
    visitor: { limit: 600, ttl: 60 * 1000 },
  })
  @UseGuards(IdValidation, StrictShareOwnerGuard)
  async create(
    @Query()
    query: {
      id: string;
      name: string;
      chunkIndex: string;
      totalChunks: string;
    },
    @Body() body: string,
    @Param("shareId") shareId: string,
  ) {
    const { id, name, chunkIndex, totalChunks } = query;

    // Data can be empty if the file is empty
    return await this.fileService.create(
      body,
      { index: parseInt(chunkIndex), total: parseInt(totalChunks) },
      { id, name },
      shareId,
    );
  }

  @SkipThrottle({ visitor: true })
  @Get("zip")
  @UseGuards(FileSecurityGuard)
  async getZip(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("shareId") shareId: string,
    @Query("recipient") recipientId?: string,
    @Query("files") files?: string,
  ) {
    const appUrl = this.config.get("general.appUrl");
    if (!isRequestFromApp(req, appUrl)) {
      redirectToSharePage(res, appUrl, shareId);
      return;
    }

    // An optional comma-separated list streams only the selected files, which
    // backs the bulk-selection download. Ids that do not belong to the share
    // are simply not matched by the query.
    const fileIds = files
      ? [
          ...new Set(
            files.split(",").filter((id) => id && VALID_ID_REGEX.test(id)),
          ),
        ]
      : undefined;

    const zipStream = await this.fileService.getZip(
      shareId,
      (req as FileRequest).shareStorageProvider,
      fileIds,
    );

    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": contentDisposition(`${shareId}.zip`),
    });
    // The archive is generated on the fly; a selected subset is never cached.
    res.set(
      fileIds
        ? NO_STORE_HEADERS
        : getZipCacheHeaders((req as FileRequest).shareIsPublic === true),
    );

    void this.fileService.notifyRecipientDownload(
      shareId,
      `${shareId}.zip`,
      getValidRecipientId(recipientId),
    );

    return new StreamableFile(zipStream);
  }

  @Throttle({
    default: {
      limit: 1200,
      ttl: 60 * 1000,
    },
  })
  @SkipThrottle({ visitor: true })
  @Get(":fileId")
  @UseGuards(FileSecurityGuard)
  async getFile(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("shareId") shareId: string,
    @Param("fileId") fileId: string,
    @Query("download") download = "true",
    @Query("webp") webp = "false",
    @Query("recipient") recipientId?: string,
  ) {
    const appUrl = this.config.get("general.appUrl");
    if (!isRequestFromApp(req, appUrl)) {
      redirectToSharePage(res, appUrl, shareId);
      return;
    }

    const isDownload = download === "true";
    // The file guard already loaded the share, so its storage provider comes
    // from the request instead of another SQLite lookup.
    const storageProvider =
      (req as FileRequest).shareStorageProvider ??
      (await this.fileService.getStorageProvider(shareId));

    // Inline image previews are converted to a smaller WebP once and served
    // from the private preview cache. Downloads keep the original format.
    if ((webp === "true" || webp === "300") && !isDownload) {
      const preview = await this.fileService.getWebpPreview(
        shareId,
        fileId,
        storageProvider,
      );
      if (preview) {
        const etag = `"${shareId}-${fileId}-webp-v300"`;
        // The converted preview is deterministic for a given file version, so
        // it can live in the shared cache for an hour.
        const cacheHeaders = getImageCacheHeaders(
          (req as FileRequest).shareIsPublic === true,
          etag,
        );
        if (isNotModified(req, cacheHeaders.ETag)) {
          res.status(HttpStatus.NOT_MODIFIED).set(cacheHeaders).end();
          return;
        }
        res.set({
          "Content-Type": "image/webp",
          "Content-Length": preview.size,
          "X-Content-Type-Options": "nosniff",
          ...cacheHeaders,
        });
        return new StreamableFile(createReadStream(preview.path));
      }
    }

    if (storageProvider === "S3") {
      const url = await this.fileService.getPreSignedDownloadUrl(
        shareId,
        fileId,
        isDownload,
        storageProvider,
      );
      // The name is only needed for the download notification; an inline
      // preview must not pay for another metadata query.
      if (isDownload) {
        const fileName = await this.fileService.getFileName(shareId, fileId);
        void this.fileService.notifyRecipientDownload(
          shareId,
          fileName,
          getValidRecipientId(recipientId),
        );
      }
      // The pre-signed URL expires after 5 minutes, so it must never be cached
      // (API responses are no-store by default).
      res.status(302).setHeader("Location", url);
      return;
    }

    const file = await this.fileService.get(
      shareId,
      fileId,
      req.headers.range,
      storageProvider,
    );

    const totalSize = parseInt(file.metaData.size, 10);

    if (file.isRangeNotSatisfiable) {
      res.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE);
      res.set({
        "Content-Range": `bytes */${totalSize}`,
        "Accept-Ranges": "bytes",
      });
      return;
    }

    const mimeType = getFileMimeType(file.metaData.name, isDownload);

    const isPassiveMedia =
      mimeType.startsWith("video/") ||
      mimeType.startsWith("audio/") ||
      (mimeType.startsWith("image/") && mimeType !== "image/svg+xml") ||
      mimeType === "text/plain";

    const headers: Record<string, string | number> = {
      "Content-Type": mimeType,
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": contentDisposition(
        file.metaData.name,
        isDownload ? undefined : { type: "inline" },
      ),
    };

    if (file.range) {
      res.status(HttpStatus.PARTIAL_CONTENT);
      headers["Content-Range"] =
        `bytes ${file.range.start}-${file.range.end}/${totalSize}`;
      headers["Content-Length"] = file.range.end - file.range.start + 1;
    } else {
      headers["Content-Length"] = totalSize;
    }

    if (!isPassiveMedia) {
      headers["Content-Security-Policy"] = "sandbox";
    }

    const cacheHeaders = getDownloadCacheHeaders(
      (req as FileRequest).shareIsPublic === true,
      `"${shareId}-${fileId}-${totalSize}"`,
    );
    Object.assign(headers, cacheHeaders);

    if (isNotModified(req, cacheHeaders.ETag)) {
      res.status(HttpStatus.NOT_MODIFIED).set(headers).end();
      return;
    }

    res.set(headers);

    if (isDownload && !file.range) {
      void this.fileService.notifyRecipientDownload(
        shareId,
        file.metaData.name,
        getValidRecipientId(recipientId),
      );
    }

    return new StreamableFile(file.file);
  }

  @Delete(":fileId")
  @Throttle({
    default: { limit: 120, ttl: 60 * 1000 },
    visitor: { limit: 120, ttl: 60 * 1000 },
  })
  @UseGuards(IdValidation, StrictShareOwnerGuard)
  async remove(
    @Param("fileId") fileId: string,
    @Param("shareId") shareId: string,
  ) {
    await this.fileService.remove(shareId, fileId);
  }
}
