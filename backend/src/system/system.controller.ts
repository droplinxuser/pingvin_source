import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Request, Response } from "express";
import { SkipThrottle } from "@nestjs/throttler";
import { AdministratorGuard } from "src/auth/guard/isAdmin.guard";
import { JwtGuard } from "src/auth/guard/jwt.guard";
import { SystemService, SystemStats } from "./system.service";
import { getEdgeCacheHeaders } from "src/utils/cache.util";
import { getRequestCountry } from "src/utils/uploaderInfo.util";
import { SystemInfoDTO } from "./dto/systemInfo.dto";

@Controller("system")
export class SystemController {
  constructor(private systemService: SystemService) {}

  @Get("info")
  @UseGuards(JwtGuard, AdministratorGuard)
  async getSystemInfo(): Promise<SystemInfoDTO | null> {
    return await this.systemService.getSystemInfo();
  }

  @Get("valkey")
  @UseGuards(JwtGuard, AdministratorGuard)
  async getValkeyMetrics() {
    return await this.systemService.getValkeyMetrics();
  }

  @Get("stats")
  @SkipThrottle({ visitor: true })
  async getSystemStats(
    @Res({ passthrough: true }) response: Response,
  ): Promise<SystemStats> {
    const stats = await this.systemService.getSystemStats();
    response.set(getEdgeCacheHeaders(60));
    return stats;
  }

  @Post("pageview")
  @HttpCode(200)
  async recordPageView(@Req() request: Request): Promise<SystemStats> {
    return await this.systemService.recordPageView(getRequestCountry(request));
  }

  @Get("robots.txt")
  @SkipThrottle({ visitor: true })
  async getRobots(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const robots = await this.systemService.getRobotsTxt(request);
    response.set(getEdgeCacheHeaders(86_400));
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    return robots;
  }

  @Get("sitemap.xml")
  @SkipThrottle({ visitor: true })
  async getSitemap(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const xml = await this.systemService.getSitemapXml(request);
    response.set(getEdgeCacheHeaders(3_600));
    response.setHeader("Content-Type", "application/xml; charset=utf-8");
    return xml;
  }

  @Get("sitemaps/:name")
  @SkipThrottle({ visitor: true })
  async getSitemapFile(
    @Param("name") name: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const xml = await this.systemService.getSitemapFile(request, name);
    // Chunk URLs include a content-hash query string, so they can be cached
    // for longer than the unversioned sitemap index.
    response.set(getEdgeCacheHeaders(86_400));
    response.setHeader("Content-Type", "application/xml; charset=utf-8");
    return xml;
  }
}
