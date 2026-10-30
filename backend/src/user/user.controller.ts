import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  FileTypeValidator,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseFilePipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { SkipThrottle, Throttle } from "@nestjs/throttler";
import { User } from "@prisma/client";
import { createReadStream } from "fs";
import { Request, Response } from "express";
import { I18nService } from "nestjs-i18n";
import { GetUser } from "src/auth/decorator/getUser.decorator";
import { AdministratorGuard } from "src/auth/guard/isAdmin.guard";
import { JwtGuard } from "src/auth/guard/jwt.guard";
import { ConfigService } from "../config/config.service";
import { isNotModified } from "src/utils/cache.util";
import { useSecureCookies } from "src/utils/cookie.util";
import { parsePagination } from "src/utils/pagination.util";
import { AvatarService } from "./avatar.service";
import { CreateUserDTO } from "./dto/createUser.dto";
import { UpdateOwnUserDTO } from "./dto/updateOwnUser.dto";
import { UpdateUserDto } from "./dto/updateUser.dto";
import { UserDTO } from "./dto/user.dto";
import { UserSevice } from "./user.service";

const AVATAR_UPLOAD_LIMIT = 5 * 1024 * 1024;

@Controller("users")
export class UserController {
  constructor(
    private userService: UserSevice,
    private avatarService: AvatarService,
    private config: ConfigService,
    private readonly i18n: I18nService,
  ) {}

  // Own user operations
  // The frontend calls this from SSR, where the IP/User-Agent belong to the
  // frontend process rather than the visitor. Keep the JWT and per-route
  // limiters, but do not share a visitor bucket between different users.
  @Get("me")
  @SkipThrottle({ default: true })
  @UseGuards(JwtGuard)
  async getCurrentUser(@GetUser() user?: User) {
    if (!user) return null;
    const userDTO = new UserDTO().from(user);
    userDTO.hasPassword = !!user.password;
    return userDTO;
  }

  @Post("me/avatar")
  @Throttle({ default: { limit: 10, ttl: 60 * 1000 } })
  @UseGuards(JwtGuard)
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: AVATAR_UPLOAD_LIMIT, files: 1 },
    }),
  )
  async uploadAvatar(
    @GetUser() user: User,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new FileTypeValidator({ fileType: /^image\/(png|jpe?g|webp)$/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    // JwtGuard is fail-open while unauthenticated shares are enabled, so the
    // avatar endpoints must not rely on the guard alone.
    if (!user) throw new UnauthorizedException();
    if (!file) throw new BadRequestException(this.i18n.t("auth.avatarInvalid"));
    return this.toCurrentUserDTO(
      await this.avatarService.save(user.id, file.buffer),
    );
  }

  @Delete("me/avatar")
  @Throttle({ default: { limit: 10, ttl: 60 * 1000 } })
  @UseGuards(JwtGuard)
  async removeAvatar(@GetUser() user: User) {
    if (!user) throw new UnauthorizedException();
    return this.toCurrentUserDTO(await this.avatarService.remove(user.id));
  }

  /**
   * Public, versioned profile picture. The file is immutable for a given
   * avatarUpdatedAt, so the frontend appends it as `?v=` and the response can
   * be cached for a year. Unversioned requests stay short-lived.
   */
  @Get(":id/avatar.webp")
  @SkipThrottle({ default: true })
  async getAvatar(
    @Param("id") id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const avatar = await this.avatarService.get(id);
    if (!avatar) throw new NotFoundException();

    const etag = `"avatar-${id}-${Math.floor(avatar.mtimeMs)}"`;
    const versioned =
      typeof request.query.v === "string" && /^\d+$/.test(request.query.v);
    // A new upload changes the URL, so versioned pictures can be cached for a
    // day. Keep the CDN copy to the same window instead of a year: deleting a
    // picture should stop serving the old URL reasonably soon, and comment
    // pages themselves are cached for at most a day.
    const browserCache = versioned
      ? "public, max-age=86400"
      : "public, max-age=300, must-revalidate";
    const edgeCache = versioned
      ? "public, max-age=0, s-maxage=86400, stale-while-revalidate=3600"
      : browserCache;
    const headers = {
      "Cache-Control": browserCache,
      "CDN-Cache-Control": edgeCache,
      "Cloudflare-CDN-Cache-Control": edgeCache,
      ETag: etag,
    };

    if (isNotModified(request, etag)) {
      response.status(304).set(headers).end();
      return;
    }

    response.set({
      ...headers,
      "Content-Type": "image/webp",
      "Content-Length": avatar.size,
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": 'inline; filename="avatar.webp"',
    });
    return new StreamableFile(createReadStream(avatar.path));
  }

  private toCurrentUserDTO(user: User) {
    const dto = new UserDTO().from(user);
    dto.hasPassword = !!user.password;
    return dto;
  }

  @Patch("me")
  @UseGuards(JwtGuard)
  async updateCurrentUser(
    @GetUser() user: User,
    @Body() data: UpdateOwnUserDTO,
  ) {
    return new UserDTO().from(await this.userService.update(user.id, data));
  }

  @Delete("me")
  @HttpCode(204)
  @UseGuards(JwtGuard)
  async deleteCurrentUser(
    @GetUser() user: User,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.userService.delete(user.id);

    const isSecure = useSecureCookies(this.config);

    response.cookie("access_token", "accessToken", {
      maxAge: -1,
      secure: isSecure,
    });
    response.cookie("refresh_token", "", {
      path: "/api/auth/token",
      httpOnly: true,
      maxAge: -1,
      secure: isSecure,
    });
  }

  // Global user operations
  @Get()
  @UseGuards(JwtGuard, AdministratorGuard)
  async list(
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
    @Query("sortBy") sortBy?: string,
    @Query("sortDirection") sortDirection?: string,
  ) {
    const {
      page: pageNum,
      pageSize: size,
      skip,
    } = parsePagination(page, pageSize);
    const [users, total] = await Promise.all([
      this.userService.list(size, skip, sortBy, sortDirection),
      this.userService.count(),
    ]);
    return {
      users: new UserDTO().fromList(users),
      total,
      page: pageNum,
      pageSize: size,
    };
  }

  @Post()
  @UseGuards(JwtGuard, AdministratorGuard)
  async create(@Body() user: CreateUserDTO) {
    return new UserDTO().from(await this.userService.create(user));
  }

  @Patch(":id")
  @UseGuards(JwtGuard, AdministratorGuard)
  async update(@Param("id") id: string, @Body() user: UpdateUserDto) {
    return new UserDTO().from(await this.userService.update(id, user));
  }

  @Delete(":id")
  @UseGuards(JwtGuard, AdministratorGuard)
  async delete(@Param("id") id: string) {
    return new UserDTO().from(await this.userService.delete(id));
  }
}
