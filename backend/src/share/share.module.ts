import { forwardRef, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ClamScanModule } from "src/clamscan/clamscan.module";
import { EmailModule } from "src/email/email.module";
import { FileModule } from "src/file/file.module";
import { ReverseShareModule } from "src/reverseShare/reverseShare.module";
import { SystemModule } from "src/system/system.module";
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
  controllers: [ShareController],
  providers: [ShareService, ShareStateService, VirusTotalService],
  exports: [ShareService],
})
export class ShareModule {}
