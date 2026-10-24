import {
  Controller,
  Get,
  HttpCode,
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
    response.set(getEdgeCacheHeaders(60));
    return await this.systemService.getSystemStats();
  }

  @Post("pageview")
  @HttpCode(200)
  async recordPageView(@Req() request: Request): Promise<SystemStats> {
    const header = request.headers["cf-ipcountry"];
    const country = Array.isArray(header) ? header[0] : header;
    return await this.systemService.recordPageView(country);
  }

  @Get("robots.txt")
  @SkipThrottle({ visitor: true })
  async getRobots(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.set(getEdgeCacheHeaders(86_400));
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    return this.systemService.getRobotsTxt(request);
  }

  @Get("sitemap.xml")
  @SkipThrottle({ visitor: true })
  async getSitemap(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.set(getEdgeCacheHeaders(3_600));
    response.setHeader("Content-Type", "application/xml; charset=utf-8");
    return this.systemService.getSitemapXml(request);
  }
}
