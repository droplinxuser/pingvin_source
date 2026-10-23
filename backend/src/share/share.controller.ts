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
  UseGuards,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Throttle, SkipThrottle } from "@nestjs/throttler";
import { Share, ShareSecurity, User } from "@prisma/client";
import { Request, Response } from "express";
import * as moment from "moment";
import { GetUser } from "src/auth/decorator/getUser.decorator";
import { AdministratorGuard } from "src/auth/guard/isAdmin.guard";
import { JwtGuard } from "src/auth/guard/jwt.guard";
import { ConfigService } from "src/config/config.service";
import { TrendingService, TrendingShare } from "src/cache/trending.service";
import { getEdgeCacheHeaders } from "src/utils/cache.util";
import { parsePagination } from "src/utils/pagination.util";
import {
  getUploaderInfo,
  writeUploaderInfo,
} from "src/utils/uploaderInfo.util";
import { AdminShareDTO } from "./dto/adminShare.dto";
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
@Controller("shares")
export class ShareController {
  constructor(
    private shareService: ShareService,
    private jwtService: JwtService,
    private config: ConfigService,
    private trending: TrendingService,
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
    @Res({ passthrough: true }) response: Response,
  ): Promise<TrendingShare[]> {
    response.set(getEdgeCacheHeaders(60));
    return this.trending.getTrending();
  }

  // Lightweight existence check used by the share page SSR so that missing
  // shares get a real 404 status without touching the share (no view count,
  // no rolling expiration, no token required).
  @Head(":id")
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
      void this.trending.recordView({ ...share, views }).catch(() => {});
    return new ShareDTO().from({
      ...share,
      views,
      uploaderInfo,
    });
  }

  @Get(":id/from-owner")
  @UseGuards(IdValidation, RegisteredShareOwnerGuard)
  async getFromOwner(@Param("id") id: string) {
    return new ShareDTO().from(await this.shareService.get(id));
  }

  @Get(":id/metaData")
  @UseGuards(IdValidation, ShareSecurityGuard)
  async getMetaData(@Param("id") id: string) {
    return new ShareMetaDataDTO().from(await this.shareService.getMetaData(id));
  }

  @Post()
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
  @UseGuards(IdValidation, CreateShareGuard, StrictShareOwnerGuard)
  async complete(@Param("id") id: string, @Req() request: Request) {
    const { reverse_share_token } = request.cookies;
    return new CompletedShareDTO().from(
      await this.shareService.complete(id, reverse_share_token),
    );
  }

  @Delete(":id/complete")
  @UseGuards(IdValidation, StrictShareOwnerGuard)
  async revertComplete(@Param("id") id: string) {
    return new ShareDTO().from(await this.shareService.revertComplete(id));
  }

  @Delete(":id")
  @UseGuards(IdValidation, ShareOwnerGuard)
  async remove(@Param("id") id: string, @GetUser() user: User) {
    const isDeleterAdmin = user?.isAdmin === true;
    await this.shareService.remove(id, isDeleterAdmin);
  }

  @Post(":id/expire")
  @HttpCode(200)
  @UseGuards(IdValidation, ShareOwnerGuard)
  async expire(@Param("id") id: string) {
    await this.shareService.expire(id);
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
    });

    return { token };
  }

  /**
   * Keeps the 10 most recent share token cookies and deletes the rest and all expired ones
   */
  private clearShareTokenCookies(request: Request, response: Response) {
    const shareTokenCookies = Object.entries(request.cookies)
      .filter(([key]) => key.startsWith("share_") && key.endsWith("_token"))
      .map(([key, value]) => ({
        key,
        payload: this.jwtService.decode(value),
      }));

    const expiredTokens = shareTokenCookies.filter(
      (cookie) => cookie.payload.exp < moment().unix(),
    );
    const validTokens = shareTokenCookies.filter(
      (cookie) => cookie.payload.exp >= moment().unix(),
    );

    expiredTokens.forEach((cookie) => response.clearCookie(cookie.key));

    if (validTokens.length > 10) {
      validTokens
        .sort((a, b) => a.payload.exp - b.payload.exp)
        .slice(0, -10)
        .forEach((cookie) => response.clearCookie(cookie.key));
    }
  }
}
