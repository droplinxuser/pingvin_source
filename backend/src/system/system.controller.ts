import { Controller, Get, Header, UseGuards } from "@nestjs/common";
import { AdministratorGuard } from "src/auth/guard/isAdmin.guard";
import { JwtGuard } from "src/auth/guard/jwt.guard";
import { SystemService } from "./system.service";
import { SystemInfoDTO } from "./dto/systemInfo.dto";
import { SystemStatsDTO } from "./dto/systemStats.dto";

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
  async getSystemStats(): Promise<SystemStatsDTO> {
    return await this.systemService.getSystemStats();
  }
}
