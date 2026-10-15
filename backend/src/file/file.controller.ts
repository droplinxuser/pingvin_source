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
import { Request, Response } from "express";
import { ConfigService } from "src/config/config.service";
import { CreateShareGuard } from "src/share/guard/createShare.guard";
import { StrictShareOwnerGuard } from "src/share/guard/strictShareOwner.guard";
import { IdValidation } from "src/share/guard/shareIdValidation.guard";
import { getFileMimeType } from "src/utils/mime.util";
import { FileService } from "./file.service";
import { FileSecurityGuard } from "./guard/fileSecurity.guard";

const VALID_ID_REGEX = /^[a-zA-Z0-9-]*={0,2}$/;

// How long Cloudflare and browsers may cache successful download responses
const DOWNLOAD_CACHE_MAX_AGE = 3600;

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

  /**
   * File downloads are only served when the request's Referer header belongs
   * to the configured app URL, so files cannot be hotlinked from other sites.
   * Requests with a missing or foreign referrer are redirected to the share
   * page instead.
   */
  private isRequestFromApp(req: Request): boolean {
    const referrer = req.headers.referer ?? req.headers["referrer"];
    if (!referrer || Array.isArray(referrer)) return false;

    try {
      const referrerUrl = new URL(referrer);
      const appUrl = new URL(this.config.get("general.appUrl"));

      // http and https are treated as equal (TLS is usually terminated by a
      // reverse proxy); the URL parser already ignores trailing slashes
      const protocolMatches =
        referrerUrl.protocol == appUrl.protocol ||
        (["http:", "https:"].includes(referrerUrl.protocol) &&
          ["http:", "https:"].includes(appUrl.protocol));

      const appUrlPath = appUrl.pathname.replace(/\/+$/, "");
      const pathMatches =
        !appUrlPath ||
        referrerUrl.pathname == appUrlPath ||
        referrerUrl.pathname.startsWith(`${appUrlPath}/`);

      return protocolMatches && referrerUrl.host == appUrl.host && pathMatches;
    } catch {
      return false;
    }
  }

  private getSharePageUrl(shareId: string): string {
    const appUrl = String(this.config.get("general.appUrl")).replace(
      /\/+$/,
      "",
    );
    return `${appUrl}/share/${shareId}`;
  }

  /**
   * Redirects to the share page with a 302 status. Unlike 301, Cloudflare
   * does not cache 302 by default; the explicit no-store headers make sure
   * neither Cloudflare nor the browser stores the redirect.
   */
  private redirectToSharePage(res: Response, shareId: string) {
    res.status(HttpStatus.FOUND).set({
      Location: this.getSharePageUrl(shareId),
      "Cache-Control": "no-store",
      "CDN-Cache-Control": "no-store",
    });
  }

  /**
   * Cloudflare's default cache key ignores cookies, so responses for
   * authenticated access must not carry public cache headers - otherwise
   * password protected or recipient restricted files would be served from
   * the edge cache to anyone.
   */
  private isAuthenticatedRequest(req: Request, shareId: string): boolean {
    return !!(
      req.cookies.access_token || req.cookies[`share_${shareId}_token`]
    );
  }

  @Post("upload-init")
  @SkipThrottle()
  @UseGuards(IdValidation, CreateShareGuard, StrictShareOwnerGuard)
  async uploadInit(
    @Body()
    body: {
      id?: string;
      name: string;
      totalChunks: number;
    },
    @Param("shareId") shareId: string,
  ) {
    return await this.fileService.createPreSignedUploadUrls(
      shareId,
      body.name,
      body.totalChunks,
    );
  }

  @Post("upload-complete")
  @SkipThrottle()
  @UseGuards(IdValidation, CreateShareGuard, StrictShareOwnerGuard)
  async uploadComplete(
    @Body()
    body: {
      id?: string;
      name: string;
      uploadId: string;
      parts: Array<{ ETag: string; PartNumber: number }>;
    },
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
  @SkipThrottle()
  @UseGuards(IdValidation, CreateShareGuard, StrictShareOwnerGuard)
  async uploadAbort(
    @Body()
    body: {
      name: string;
      uploadId: string;
    },
    @Param("shareId") shareId: string,
  ) {
    await this.fileService.abortPreSignedUpload(
      shareId,
      body.name,
      body.uploadId,
    );
  }

  @Post()
  @SkipThrottle()
  @UseGuards(IdValidation, CreateShareGuard, StrictShareOwnerGuard)
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

  @Get("zip")
  @UseGuards(FileSecurityGuard)
  async getZip(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("shareId") shareId: string,
    @Query("recipient") recipientId?: string,
  ) {
    if (!this.isRequestFromApp(req)) {
      this.redirectToSharePage(res, shareId);
      return;
    }

    const zipStream = await this.fileService.getZip(shareId);

    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": contentDisposition(`${shareId}.zip`),
    });

    // Successful, unauthenticated zip downloads may be cached on Cloudflare
    // edge servers; authenticated downloads stay out of shared caches because
    // the cache key ignores cookies
    if (this.isAuthenticatedRequest(req, shareId)) {
      res.set({ "Cache-Control": "private" });
    } else {
      res.set({
        "Cache-Control": `public, max-age=${DOWNLOAD_CACHE_MAX_AGE}`,
        "CDN-Cache-Control": `public, max-age=${DOWNLOAD_CACHE_MAX_AGE}`,
      });
    }

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
  @Get(":fileId")
  @UseGuards(FileSecurityGuard)
  async getFile(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("shareId") shareId: string,
    @Param("fileId") fileId: string,
    @Query("download") download = "true",
    @Query("recipient") recipientId?: string,
  ) {
    if (!this.isRequestFromApp(req)) {
      this.redirectToSharePage(res, shareId);
      return;
    }

    const isDownload = download === "true";
    const storageProvider = await this.fileService.getStorageProvider(shareId);

    if (storageProvider === "S3") {
      const url = await this.fileService.getPreSignedDownloadUrl(
        shareId,
        fileId,
        isDownload,
      );
      const fileName = await this.fileService.getFileName(shareId, fileId);
      if (isDownload) {
        void this.fileService.notifyRecipientDownload(
          shareId,
          fileName,
          getValidRecipientId(recipientId),
        );
      }
      // The pre-signed URL expires after 5 minutes, so the redirect must
      // never be cached
      res.status(302).set({
        Location: url,
        "Cache-Control": "no-store",
        "CDN-Cache-Control": "no-store",
      });
      return;
    }

    const file = await this.fileService.get(shareId, fileId, req.headers.range);

    const totalSize = parseInt(file.metaData.size, 10);

    if (file.isRangeNotSatisfiable) {
      res.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE);
      res.set({
        "Content-Range": `bytes */${totalSize}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "CDN-Cache-Control": "no-store",
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

    if (isDownload && !file.range) {
      if (this.isAuthenticatedRequest(req, shareId)) {
        // Shared caches (e.g. Cloudflare) must never store authenticated
        // downloads, because the cache key ignores cookies
        headers["Cache-Control"] = "private";
      } else {
        // Successful (full 200), unauthenticated downloads may be cached on
        // Cloudflare edge servers
        headers["Cache-Control"] = `public, max-age=${DOWNLOAD_CACHE_MAX_AGE}`;
        headers["CDN-Cache-Control"] =
          `public, max-age=${DOWNLOAD_CACHE_MAX_AGE}`;
      }
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
  @SkipThrottle()
  @UseGuards(IdValidation, CreateShareGuard, StrictShareOwnerGuard)
  async remove(
    @Param("fileId") fileId: string,
    @Param("shareId") shareId: string,
  ) {
    await this.fileService.remove(shareId, fileId);
  }
}
