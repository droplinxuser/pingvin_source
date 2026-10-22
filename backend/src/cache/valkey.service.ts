import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from "@nestjs/common";
import { createClient } from "@keyv/redis";
import { ConfigService } from "src/config/config.service";

export type ValkeyClient = ReturnType<typeof createClient>;

const RECONNECT_DELAY_MS = 30 * 1000;

/**
 * Shared connection for data structures that need atomic Valkey operations
 * (counters, hashes, sets) and cannot use the cache-manager wrapper. If the
 * server is unavailable every caller falls back to its own safe path.
 */
@Injectable()
export class ValkeyService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ValkeyService.name);
  private readonly enabled: boolean;
  private readonly url: string;
  private client?: ValkeyClient;
  private connecting?: Promise<ValkeyClient | undefined>;
  private retryAt = 0;

  constructor(config: ConfigService) {
    this.enabled = config.get("cache.redis-enabled") === true;
    this.url = config.get("cache.redis-url") || "";
  }

  async onModuleInit() {
    if (this.enabled && this.url) await this.getClient();
  }

  async run<T>(
    operation: (client: ValkeyClient) => Promise<T>,
  ): Promise<T | undefined> {
    const client = await this.getClient();
    if (!client) return undefined;

    try {
      return await operation(client);
    } catch (error) {
      this.logger.warn(`Valkey operation failed; using fallback: ${error}`);
      await this.disconnect();
      return undefined;
    }
  }

  private async getClient(): Promise<ValkeyClient | undefined> {
    if (!this.enabled || !this.url) return undefined;
    if (this.client?.isOpen) return this.client;
    if (this.connecting) return this.connecting;
    if (Date.now() < this.retryAt) return undefined;

    this.retryAt = Date.now() + RECONNECT_DELAY_MS;
    this.connecting = this.connect();
    try {
      return await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  private async connect(): Promise<ValkeyClient | undefined> {
    try {
      const client = createClient({
        url: this.url,
        disableOfflineQueue: true,
        socket: {
          connectTimeout: 2000,
          reconnectStrategy: false,
        },
      });
      client.on("error", (error) => {
        this.logger.debug(`Valkey connection error: ${error.message}`);
      });
      await client.connect();
      this.client = client;
      return client;
    } catch (error) {
      this.logger.warn(`Valkey unavailable; using fallback: ${error}`);
      return undefined;
    }
  }

  private async disconnect() {
    const client = this.client;
    this.client = undefined;
    if (client?.isOpen) await client.disconnect().catch(() => {});
  }

  async onApplicationShutdown() {
    const client = this.client;
    this.client = undefined;
    if (client?.isOpen) await client.quit().catch(() => {});
  }
}
