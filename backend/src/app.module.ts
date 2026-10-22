import { Module } from "@nestjs/common";

import { ScheduleModule } from "@nestjs/schedule";
import { AuthModule } from "./auth/auth.module";

import { createHash } from "crypto";
import { existsSync } from "fs";
import { join } from "path";
import { I18nModule } from "nestjs-i18n";

import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AppCacheModule } from "./cache/cache.module";
import { AppController } from "./app.controller";
import { ClamScanModule } from "./clamscan/clamscan.module";
import { ConfigModule } from "./config/config.module";
import { EmailModule } from "./email/email.module";
import { FileModule } from "./file/file.module";
import { JobsModule } from "./jobs/jobs.module";
import { OAuthModule } from "./oauth/oauth.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ReverseShareModule } from "./reverseShare/reverseShare.module";
import { ShareModule } from "./share/share.module";
import { UserModule } from "./user/user.module";
import { SystemModule } from "./system/system.module";
import { AdminNoticeModule } from "./adminNotice/adminNotice.module";

import { SystemLanguageResolver } from "./i18n/systemLanguage.resolver";

const i18nPath = existsSync(join(__dirname, "../i18n"))
  ? join(__dirname, "../i18n")
  : join(__dirname, "i18n");

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const VISITOR_RATE_LIMIT = positiveInt(process.env.VISITOR_RATE_LIMIT, 90);
const VISITOR_RATE_TTL_MS = positiveInt(
  process.env.VISITOR_RATE_TTL_MS,
  60 * 1000,
);
const VISITOR_RATE_BLOCK_MS = positiveInt(
  process.env.VISITOR_RATE_BLOCK_MS,
  60 * 1000,
);

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    ShareModule,
    FileModule,
    EmailModule,
    PrismaModule,
    JobsModule,
    UserModule,
    SystemModule,
    AdminNoticeModule,
    ThrottlerModule.forRoot([
      {
        name: "default",
        ttl: 60 * 1000,
        limit: parseInt(process.env.THROTTLE_LIMIT || "100"),
        blockDuration: 60 * 1000,
      },
      {
        name: "visitor",
        ttl: VISITOR_RATE_TTL_MS,
        limit: VISITOR_RATE_LIMIT,
        blockDuration: VISITOR_RATE_BLOCK_MS,
        getTracker: (req) =>
          typeof req.visitorKey === "string" ? req.visitorKey : `ip:${req.ip}`,
        generateKey: (_context, tracker) =>
          createHash("sha256")
            .update(`visitor:${tracker}`)
            .digest("hex"),
      },
    ]),
    ScheduleModule.forRoot(),
    ClamScanModule,
    ReverseShareModule,
    OAuthModule,
    AppCacheModule,
    I18nModule.forRoot({
      fallbackLanguage: "en-US",
      loaderOptions: {
        path: i18nPath,
        watch: true,
      },
      resolvers: [SystemLanguageResolver],
    }),
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    SystemLanguageResolver,
  ],
})
export class AppModule {}
