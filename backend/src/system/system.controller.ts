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
import { AdministratorGuard } from "src/auth/guard/isAdmin.guard";
import { JwtGuard } from "src/auth/guard/jwt.guard";
import { SystemService, SystemStats } from "./system.service";
import { getPublicCacheHeaders } from "src/utils/cache.util";
import { SystemInfoDTO } from "./dto/systemInfo.dto";

@Controller("system")
export class SystemController {
  constructor(private systemService: SystemService) {}

  @Get("info")
  @UseGuards(JwtGuard, AdministratorGuard)
  async getSystemInfo(): Promise<SystemInfoDTO | null> {
    return await this.systemService.getSystemInfo();
  }

  @Get("stats")
  async getSystemStats(
    @Res({ passthrough: true }) response: Response,
  ): Promise<SystemStats> {
    response.set(getPublicCacheHeaders(60));
    return await this.systemService.getSystemStats();
  }

  @Post("pageview")
  @HttpCode(200)
  async recordPageView(@Req() request: Request): Promise<SystemStats> {
    const header = request.headers["cf-ipcountry"];
    const country = Array.isArray(header) ? header[0] : header;
    const visitorKey = (request as Request & { visitorKey?: string })
      .visitorKey;
    return await this.systemService.recordPageView(country, visitorKey);
  }
}
