import { Controller, Get, Header, UseGuards } from "@nestjs/common";
import { AdministratorGuard } from "src/auth/guard/isAdmin.guard";
import { JwtGuard } from "src/auth/guard/jwt.guard";
import { SystemService, SystemStats } from "./system.service";
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
  @Header("Cache-Control", "public, max-age=60")
  @Header("CDN-Cache-Control", "public, max-age=60")
  @Header("Cloudflare-CDN-Cache-Control", "public, max-age=60")
  async getSystemStats(): Promise<SystemStats> {
    return await this.systemService.getSystemStats();
  }
}
