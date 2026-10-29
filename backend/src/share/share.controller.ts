import {
  Body,
  Controller,
  Delete,
  Get,
  Head,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Throttle, SkipThrottle } from "@nestjs/throttler";
import { Share, ShareSecurity, User } from "@prisma/client";
import { createReadStream } from "fs";
import { Request, Response } from "express";
import * as moment from "moment";
import { GetUser } from "src/auth/decorator/getUser.decorator";
import { AdministratorGuard } from "src/auth/guard/isAdmin.guard";
import { JwtGuard } from "src/auth/guard/jwt.guard";
import { ConfigService } from "src/config/config.service";
import { useSecureCookies } from "src/utils/cookie.util";
import { FileService } from "src/file/file.service";
import {
  TrendingCountry,
  TrendingService,
  TrendingShare,
} from "src/cache/trending.service";
import { SearchService } from "src/cache/search.service";
import { DownloadService } from "src/cache/download.service";
import {
  NO_STORE_HEADERS,
  getEdgeCacheHeaders,
  getImageCacheHeaders,
  isNotModified,
} from "src/utils/cache.util";
import { parsePagination } from "src/utils/pagination.util";
import {
  getRequestCountry,
  getUploaderInfo,
  writeUploaderInfo,
} from "src/utils/uploaderInfo.util";
import { COMMENTS_EDGE_CACHE_SECONDS, CommentService } from "./comment.service";
import { AdminShareDTO } from "./dto/adminShare.dto";
import { CommentContentDTO } from "./dto/commentContent.dto";
import { CreateShareDTO } from "./dto/createShare.dto";
import { MyShareDTO } from "./dto/myShare.dto";
import { ReceivedShareDTO } from "./dto/receivedShare.dto";
import { ReportShareDTO } from "./dto/reportShare.dto";
import { ShareDTO } from "./dto/share.dto";
import { ShareMetaDataDTO } from "./dto/shareMetaData.dto";
import { SharePasswordDto } from "./dto/sharePassword.dto";
import { UpdateShareDTO } from "./dto/updateShare.dto";
import { GetShare } from "./decorator/getShare.decorator";
import { CreateShareGuard } from "./guard/createShare.guard";
import { ShareOwnerGuard } from "./guard/shareOwner.guard";
import { StrictShareOwnerGuard } from "./guard/strictShareOwner.guard";
import { RegisteredShareOwnerGuard } from "./guard/registeredShareOwner.guard";
import { ReceivedSharesGuard } from "./guard/receivedShares.guard";
import { ShareSecurityGuard } from "./guard/shareSecurity.guard";
import { ShareTokenSecurity } from "./guard/shareTokenSecurity.guard";
import { IdValidation } from "./guard/shareIdValidation.guard";
import { ShareService } from "./share.service";
import { CompletedShareDTO } from "./dto/shareComplete.dto";

// A ZIP can attribute one download to many files; cap the list so a beacon
// cannot turn into an unbounded Valkey write.
const MAX_DOWNLOAD_FILE_IDS = 500;
const DOWNLOAD_FILE_ID_REGEX = /^[a-zA-Z0-9-]*={0,2}$/;

function normalizeDownloadFileIds(fileIds: unknown): string[] {
  if (!Array.isArray(fileIds)) return [];
  const valid = fileIds.filter(
    (id): id is string =>
      typeof id === "string" && DOWNLOAD_FILE_ID_REGEX.test(id),
  );
  return [...new Set(valid)].slice(0, MAX_DOWNLOAD_FILE_IDS);
}

@Controller("shares")
export class ShareController {
  constructor(
    private shareService: ShareService,
    private jwtService: JwtService,
    private config: ConfigService,
    private trending: TrendingService,
    private searchService: SearchService,
    private commentService: CommentService,
    private fileService: FileService,
    private downloadService: DownloadService,
  ) {}

  @Get("all")
  @UseGuards(JwtGuard, AdministratorGuard)
  async getAllShares(
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
    @Query("search") search = "",
    @Query("sortBy") sortBy?: string,
    @Query("sortDirection") sortDirection?: string,
  ) {
    const {
      page: pageNum,
      pageSize: size,
      skip,
    } = parsePagination(page, pageSize);
    const searchTerm = typeof search === "string" ? search.trim() : "";

    const [shares, count] = await Promise.all([
      this.shareService.getShares(
        size,
        skip,
        searchTerm,
        sortBy,
        sortDirection,
      ),
      this.shareService.countShares(searchTerm),
    ]);
    return {
      shares: new AdminShareDTO().fromList(shares),
      total: count,
      page: pageNum,
      pageSize: size,
    };
  }

  @Get()
  @UseGuards(JwtGuard)
  async getMyShares(@GetUser() user: User) {
    return new MyShareDTO().fromList(
      await this.shareService.getSharesByUser(user.id),
    );
  }

  @Get("received")
  @UseGuards(ReceivedSharesGuard)
  async getReceivedShares(@GetUser() user: User) {
    return new ReceivedShareDTO().fromList(
      await this.shareService.getReceivedShares(user.id),
    );
  }

  @Get("trending")
  @SkipThrottle({ default: true, visitor: true })
  async getTrending(
    @Query("limit") limit: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TrendingShare[]> {
    const parsedLimit = Number.parseInt(limit ?? "", 10);
    const items = await this.trending.getTrending(
      Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    );
    response.set(getEdgeCacheHeaders(60));
    void this.fileService.warmShareThumbnails(items.map((item) => item.id));
    return items;
  }

  // Country aggregates only change as views arrive; five minutes matches the
  // in-process cache and keeps Cloudflare and the origin in sync.
  @Get("trending/countries")
  @SkipThrottle({ default: true, visitor: true })
  async getTrendingCountries(
    @Res({ passthrough: true }) response: Response,
  ): Promise<TrendingCountry[]> {
    const countries = await this.trending.getTrendingCountries();
    response.set(getEdgeCacheHeaders(300));
    void this.fileService.warmShareThumbnails(
      countries.flatMap((country) => country.shares.map((item) => item.id)),
    );
    return countries;
  }

  // Newest public shares with a renderable image/video preview. The card shape
  // is shared with trending so both pages use the same UI and cache policy.
  @Get("recent")
  @SkipThrottle({ default: true, visitor: true })
  async getRecent(
    @Query("limit") limit: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TrendingShare[]> {
    const parsedLimit = Number.parseInt(limit ?? "", 10);
    const items = await this.trending.getRecent(
      Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    );
    response.set(getEdgeCacheHeaders(60));
    void this.fileService.warmShareThumbnails(items.map((item) => item.id));
    return items;
  }

  // Newest public shares without an image/video preview ("files"). Same card
  // shape and cache policy as the media listing so both pages share the UI.
  @Get("recent-files")
  @SkipThrottle({ default: true, visitor: true })
  async getRecentFiles(
    @Query("limit") limit: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TrendingShare[]> {
    const parsedLimit = Number.parseInt(limit ?? "", 10);
    const items = await this.trending.getRecentFiles(
      Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    );
    response.set(getEdgeCacheHeaders(60));
    void this.fileService.warmShareThumbnails(items.map((item) => item.id));
    return items;
  }

  // Search across every public share. The index lives in Valkey; results are
  // edge-cached for a minute. A missing/blank query returns an empty list.
  @Get("search")
  @Throttle({ default: { limit: 60, ttl: 60 * 1000 } })
  @SkipThrottle({ visitor: true })
  async search(
    @Query("q") q: string,
    @Query("limit") limit: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TrendingShare[]> {
    const parsedLimit = Number.parseInt(limit ?? "", 10);
    const items = await this.searchService.search(
      typeof q === "string" ? q : "",
      Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    );
    // Search results are stable for a while; keep them at the edge for an hour
    // to absorb repeat queries. A transient empty result is never pinned.
    response.set(items.length ? getEdgeCacheHeaders(3600) : NO_STORE_HEADERS);
    void this.fileService.warmShareThumbnails(items.map((item) => item.id));
    return items;
  }

  // Lightweight existence check used by external monitors and the share page
  // SSR so missing shares get a real 404 without recording a view.
  @Head(":id")
  @Throttle({ default: { limit: 60, ttl: 60 * 1000 } })
  @SkipThrottle({ visitor: true })
  async exists(@Param("id") id: string) {
    if (!(await this.shareService.shareExists(id)))
      throw new NotFoundException();
  }

  @Get(":id")
  @UseGuards(IdValidation, ShareSecurityGuard)
  async get(@Param("id") id: string, @Req() request: Request) {
    const share = await this.shareService.get(id);
    const { views, uploaderInfo } = await this.shareService.recordView(
      id,
      request,
      share.maxViews,
    );
    if ((request as Request & { shareIsPublic?: boolean }).shareIsPublic)
      void this.trending
        .recordView({ ...share, views }, getRequestCountry(request))
        .catch(() => {});
    // Download counters are public (they ride the share payload) and cached
    // for a few seconds in DownloadService so this stays off the hot path.
    const downloads = await this.downloadService.getShareDownloads(id);
    return new ShareDTO().from({
      ...share,
      views,
      uploaderInfo,
      downloads,
    });
  }

  /**
   * Download-count beacon. Files are served from the Cloudflare edge, so the
   * origin never sees most downloads; the client sends this small no-store
   * request on each download (and once per file for a ZIP). This keeps the
   * counters accurate without giving up edge caching, mirroring how share
   * views stay accurate. Guarded like the share so only visitors who may
   * access it can count a download.
   */
  @Post(":id/download")
  @Throttle({
    default: { limit: 300, ttl: 60 * 1000 },
    visitor: { limit: 120, ttl: 60 * 1000 },
  })
  @UseGuards(IdValidation, ShareSecurityGuard)
  async recordDownload(
    @Param("id") id: string,
    @Body() body: { fileIds?: unknown },
  ) {
    await this.downloadService.recordDownload(
      id,
      normalizeDownloadFileIds(body?.fileIds),
    );
    return { counted: true };
  }

  @Throttle({
    default: {
      limit: 1200,
      ttl: 60 * 1000,
    },
  })
  @SkipThrottle({ visitor: true })
  @Get(":id/thumbnail")
  @UseGuards(IdValidation, ShareSecurityGuard)
  async getThumbnail(
    @Param("id") id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const thumbnail = await this.fileService.getShareThumbnail(id);
    if (!thumbnail) {
      const placeholder = await this.fileService.getThumbnailPlaceholder();
      response.set({
        "Content-Type": "image/webp",
        "Content-Length": placeholder.length,
        "X-Content-Type-Options": "nosniff",
        "X-Thumbnail-Reason": this.fileService.getThumbnailFailureReason(id),
        ...NO_STORE_HEADERS,
      });
      return new StreamableFile(placeholder);
    }

    const isPublic =
      (request as Request & { shareIsPublic?: boolean }).shareIsPublic === true;
    // Thumbnails are keyed by share id and refreshed when the share is edited,
    // so the edge may keep them for an hour.
    const cacheHeaders = getImageCacheHeaders(isPublic, `"${id}-thumbnail"`);
    if (isNotModified(request, cacheHeaders.ETag)) {
      response.status(304).set(cacheHeaders).end();
      return;
    }
    response.set({
      "Content-Type": "image/webp",
      "Content-Length": thumbnail.size,
      "X-Content-Type-Options": "nosniff",
      ...cacheHeaders,
    });
    return new StreamableFile(createReadStream(thumbnail.path));
  }

  @Get(":id/seo")
  @SkipThrottle({ visitor: true })
  @UseGuards(IdValidation)
  async getSeo(
    @Param("id") id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    // Set the cache headers only for a successful, indexable payload. A
    // missing, protected or restricted share must keep the API's default
    // no-store so old metadata can never be pinned at the edge after an edit.
    const seo = await this.shareService.getSeo(id);
    response.set(seo.indexable ? getEdgeCacheHeaders(60) : NO_STORE_HEADERS);
    return seo;
  }

  /**
   * Lazy-loaded comment listing. Public shares are cached at the edge for a
   * month; the `v` query string comes from the share payload and changes on
   * every create/edit/delete, so a new visitor always requests the current
   * version instead of a stale edge entry. Protected shares are never stored
   * by Cloudflare.
   */
  @Get(":id/comments")
  @SkipThrottle({ visitor: true })
  @UseGuards(IdValidation, ShareSecurityGuard)
  async getComments(
    @Param("id") id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Query("page") page = "1",
  ) {
    const isPublic = (request as Request & { shareIsPublic?: boolean })
      .shareIsPublic;
    response.set(
      isPublic
        ? getEdgeCacheHeaders(COMMENTS_EDGE_CACHE_SECONDS)
        : NO_STORE_HEADERS,
    );
    return this.commentService.list(id, page);
  }

  @Throttle({
    default: {
      limit: 5,
      ttl: 60 * 1000,
    },
  })
  @UseGuards(IdValidation, ShareSecurityGuard)
  @Post(":id/comments")
  async createComment(
    @Param("id") id: string,
    @Body() body: CommentContentDTO,
    @GetUser() user: User,
  ) {
    if (!user) throw new UnauthorizedException();
    const result = await this.commentService.create(id, user, body.content);
    await this.shareService.invalidateCommentsDataCache(id);
    return result;
  }

  @Throttle({
    default: {
      limit: 10,
      ttl: 60 * 1000,
    },
  })
  @UseGuards(IdValidation, ShareSecurityGuard)
  @Patch(":id/comments/:commentId")
  async updateComment(
    @Param("id") id: string,
    @Param("commentId") commentId: string,
    @Body() body: CommentContentDTO,
    @GetUser() user: User,
  ) {
    if (!user) throw new UnauthorizedException();
    const result = await this.commentService.update(
      id,
      commentId,
      user,
      body.content,
    );
    await this.shareService.invalidateCommentsDataCache(id);
    return result;
  }

  @Throttle({
    default: {
      limit: 10,
      ttl: 60 * 1000,
    },
  })
  @UseGuards(IdValidation, ShareSecurityGuard)
  @Delete(":id/comments/:commentId")
  async deleteComment(
    @Param("id") id: string,
    @Param("commentId") commentId: string,
    @GetUser() user: User,
  ) {
    if (!user) throw new UnauthorizedException();
    const result = await this.commentService.remove(id, commentId, user);
    await this.shareService.invalidateCommentsDataCache(id);
    return result;
  }

  @Get(":id/from-owner")
  @UseGuards(IdValidation, RegisteredShareOwnerGuard)
  async getFromOwner(@Param("id") id: string) {
    const share = await this.shareService.get(id);
    const downloads = await this.downloadService.getShareDownloads(id);
    return new ShareDTO().from({ ...share, downloads });
  }

  @Get(":id/metaData")
  @UseGuards(IdValidation, ShareSecurityGuard)
  async getMetaData(@Param("id") id: string) {
    return new ShareMetaDataDTO().from(await this.shareService.getMetaData(id));
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60 * 1000 } })
  @UseGuards(CreateShareGuard)
  async create(
    @Body() body: CreateShareDTO,
    @Req() request: Request,
    @GetUser() user: User,
  ) {
    const { reverse_share_token } = request.cookies;
    const share = await this.shareService.create(
      body,
      user,
      reverse_share_token,
    );
    await writeUploaderInfo(share.id, {
      ...getUploaderInfo(request),
      visitors: [],
    });
    return new ShareDTO().from(share);
  }

  @Patch(":id")
  @UseGuards(IdValidation, ShareOwnerGuard)
  async update(
    @Param("id") id: string,
    @Body() body: UpdateShareDTO,
    @GetShare() share: Share & { security?: ShareSecurity },
    @GetUser() user: User,
  ) {
    return new MyShareDTO().from(
      await this.shareService.update(id, body, user, share),
    );
  }

  @Post(":id/complete")
  @HttpCode(202)
  @UseGuards(IdValidation, StrictShareOwnerGuard)
  async complete(@Param("id") id: string) {
    return new CompletedShareDTO().from(await this.shareService.complete(id));
  }

  @Delete(":id/complete")
  @UseGuards(IdValidation, StrictShareOwnerGuard)
  async revertComplete(@Param("id") id: string) {
    return new ShareDTO().from(await this.shareService.revertComplete(id));
  }

  @Delete(":id")
  @UseGuards(IdValidation, ShareOwnerGuard)
  async remove(
    @Param("id") id: string,
    @GetUser() user: User,
    @GetShare() share: Share,
  ) {
    const isDeleterAdmin = user?.isAdmin === true;
    await this.shareService.remove(id, isDeleterAdmin, share);
  }

  @Post(":id/expire")
  @HttpCode(200)
  @UseGuards(IdValidation, ShareOwnerGuard)
  async expire(@Param("id") id: string, @GetShare() share: Share) {
    await this.shareService.expire(id, share);
  }

  @Throttle({
    default: {
      limit: 5,
      ttl: 60 * 1000,
    },
  })
  @HttpCode(200)
  @UseGuards(IdValidation)
  @Post(":id/report")
  async report(@Param("id") id: string, @Body() body: ReportShareDTO) {
    await this.shareService.report(id, body);
  }

  @Throttle({
    default: {
      limit: 10,
      ttl: 60 * 1000,
    },
  })
  @Get("isShareIdAvailable/:id")
  async isShareIdAvailable(@Param("id") id: string) {
    return this.shareService.isShareIdAvailable(id);
  }

  @HttpCode(200)
  @Throttle({
    default: {
      limit: 20,
      ttl: 5 * 60 * 1000,
    },
  })
  @UseGuards(IdValidation, ShareTokenSecurity)
  @Post(":id/token")
  async getShareToken(
    @Param("id") id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: SharePasswordDto,
  ) {
    const token = await this.shareService.getShareToken(id, body.password);

    this.clearShareTokenCookies(request, response);
    response.cookie(`share_${id}_token`, token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: useSecureCookies(this.config),
    });

    return { token };
  }

  /**
   * Keeps the 10 most recent share token cookies and deletes the rest and all expired ones
   */
  private clearShareTokenCookies(request: Request, response: Response) {
    const now = moment().unix();
    const shareTokenCookies = Object.entries(request.cookies)
      .filter(([key]) => key.startsWith("share_") && key.endsWith("_token"))
      .map(([key, value]) => {
        try {
          const payload = this.jwtService.decode(value) as {
            exp?: number;
          } | null;
          return { key, exp: payload?.exp };
        } catch {
          // A malformed/legacy cookie must not break the token endpoint.
          return { key, exp: undefined };
        }
      });

    const validTokens = shareTokenCookies.filter(
      (cookie) => typeof cookie.exp === "number" && cookie.exp >= now,
    );
    // Tokens for never-expiring shares have no `exp` claim and stay valid.
    shareTokenCookies
      .filter((cookie) => typeof cookie.exp === "number" && cookie.exp < now)
      .forEach((cookie) => response.clearCookie(cookie.key));

    if (validTokens.length > 10) {
      validTokens
        .sort((a, b) => (a.exp ?? 0) - (b.exp ?? 0))
        .slice(0, -10)
        .forEach((cookie) => response.clearCookie(cookie.key));
    }
  }
}
