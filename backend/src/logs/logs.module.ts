import { Module } from "@nestjs/common";
import { ErrorLogService } from "./errorLog.service";
import { LogsAdminController, LogsController } from "./logs.controller";

@Module({
  controllers: [LogsController, LogsAdminController],
  providers: [ErrorLogService],
  exports: [ErrorLogService],
})
export class LogsModule {}
