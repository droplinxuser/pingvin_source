import { Global, Module } from "@nestjs/common";
import { AppCacheModule } from "src/cache/cache.module";
import { VirusTotalQueueService } from "./virustotalQueue.service";

@Global()
@Module({
  imports: [AppCacheModule],
  providers: [VirusTotalQueueService],
  exports: [VirusTotalQueueService],
})
export class VirusTotalQueueModule {}
