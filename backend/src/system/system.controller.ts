import { Controller, Get, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";
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
}
