import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AdministratorGuard } from "src/auth/guard/isAdmin.guard";
import { JwtGuard } from "src/auth/guard/jwt.guard";
import { VirusTotalAuditService } from "./virustotalAudit.service";
import { VirusTotalService } from "./virustotal.service";

@Controller("admin/virustotal")
@UseGuards(JwtGuard, AdministratorGuard)
export class VirusTotalAdminController {
  constructor(
    private readonly virusTotalService: VirusTotalService,
    private readonly auditService: VirusTotalAuditService,
  ) {}

  @Get()
  async getDashboard(@Query("limit") limit?: string) {
    const parsed = Number.parseInt(limit ?? "", 10);
    const eventLimit = Number.isFinite(parsed)
      ? Math.min(Math.max(parsed, 1), 200)
      : 100;

    return {
      generatedAt: new Date().toISOString(),
      status: await this.virusTotalService.getAdminStatus(),
      ...this.auditService.getOverview(eventLimit),
    };
  }
}
