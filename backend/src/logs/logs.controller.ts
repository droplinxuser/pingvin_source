import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Request } from "express";
import { AdministratorGuard } from "src/auth/guard/isAdmin.guard";
import { JwtGuard } from "src/auth/guard/jwt.guard";
import { parsePagination } from "src/utils/pagination.util";
import { ClientErrorDTO } from "./dto/clientError.dto";
import { ErrorLogService } from "./errorLog.service";

@Controller("logs")
export class LogsController {
  constructor(private readonly errorLogs: ErrorLogService) {}

  // Browsers report uncaught errors here. The default per-route limiter still
  // bounds the request rate; the visitor bucket is skipped so an error storm
  // cannot use up the budget that normal page loads and uploads rely on.
  @Post("client")
  // Client error reports are unauthenticated; a tight per-IP cap keeps them
  // from evicting real alerts from the capped admin log.
  @Throttle({ default: { limit: 10, ttl: 60 * 1000 } })
  @HttpCode(204)
  async reportClientError(
    @Body() body: ClientErrorDTO,
    @Req() request: Request,
  ): Promise<void> {
    const header = request.headers["user-agent"];
    await this.errorLogs.add("frontend", {
      message: body.message,
      stack: body.stack,
      context: body.context,
      url: body.url,
      userAgent: Array.isArray(header) ? header[0] : header,
    });
  }
}

@Controller("admin/logs")
@UseGuards(JwtGuard, AdministratorGuard)
export class LogsAdminController {
  constructor(private readonly errorLogs: ErrorLogService) {}

  @Get()
  async list(
    @Query("source") source?: string,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
  ) {
    const pagination = parsePagination(page, pageSize);
    return this.errorLogs.list(
      source === "frontend" ? "frontend" : "backend",
      pagination.page,
      pagination.pageSize,
    );
  }
}
