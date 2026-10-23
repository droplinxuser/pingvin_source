import { Global, Logger, Module } from "@nestjs/common";
import { CacheModule } from "@nestjs/cache-manager";
import { CacheableMemory } from "cacheable";
import { createKeyv } from "@keyv/redis";
import { Keyv } from "keyv";
import { ConfigModule } from "src/config/config.module";
import { ConfigService } from "src/config/config.service";
import { MetricsService } from "./metrics.service";
import { ValkeyService } from "./valkey.service";

const logger = new Logger("AppCacheModule");
let lastCacheErrorLog = 0;

@Global()
@Module({
  imports: [
    ConfigModule,
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const useRedis = configService.get("cache.redis-enabled");
        const ttl = configService.get("cache.ttl");
        const max = configService.get("cache.maxItems");

        const config = {
          ttl,
          max,
          stores: [],
        };

        const redisUrl = configService.get("cache.redis-url");
        if (useRedis && redisUrl) {
          const redisStore = createKeyv({
            url: redisUrl,
            disableOfflineQueue: true,
            socket: {
              connectTimeout: 2000,
              reconnectStrategy: (retries) => Math.min(retries * 200, 3000),
            },
          });
          redisStore.on("error", (error) => {
            if (Date.now() - lastCacheErrorLog < 30_000) return;
            lastCacheErrorLog = Date.now();
            logger.warn(
              `Redis cache unavailable; using memory fallback: ${error}`,
            );
          });
          config.stores = [
            new Keyv({ store: new CacheableMemory({ ttl, lruSize: 5000 }) }),
            redisStore,
          ];
        }

        return config;
      },
    }),
  ],
  providers: [ValkeyService, MetricsService],
  exports: [CacheModule, ValkeyService, MetricsService],
})
export class AppCacheModule {}
