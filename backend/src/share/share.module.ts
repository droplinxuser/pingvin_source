import { forwardRef, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ClamScanModule } from "src/clamscan/clamscan.module";
import { EmailModule } from "src/email/email.module";
import { FileModule } from "src/file/file.module";
import { ReverseShareModule } from "src/reverseShare/reverseShare.module";
import { SystemModule } from "src/system/system.module";
import { VirusTotalAdminController } from "src/virustotal/virustotalAdmin.controller";
import { VirusTotalAuditService } from "src/virustotal/virustotalAudit.service";
import { VirusTotalService } from "src/virustotal/virustotal.service";
import { ShareController } from "./share.controller";
import { ShareService } from "./share.service";
import { ShareStateService } from "./shareState.service";

@Module({
  imports: [
    JwtModule.register({}),
    EmailModule,
    forwardRef(() => ClamScanModule),
    ReverseShareModule,
    forwardRef(() => FileModule),
    SystemModule,
  ],
  controllers: [ShareController, VirusTotalAdminController],
  providers: [
    ShareService,
    ShareStateService,
    VirusTotalService,
    VirusTotalAuditService,
  ],
  exports: [ShareService],
})
export class ShareModule {}
