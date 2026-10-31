import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Config } from "@prisma/client";
import * as argon from "argon2";
import { EventEmitter } from "events";
import * as fs from "fs";
import { PrismaService } from "src/prisma/prisma.service";
import { stringToTimespan } from "src/utils/date.util";
import { parse as yamlParse } from "yaml";
import { I18nContext } from "nestjs-i18n";
import { YamlConfig } from "../../prisma/seed/config.seed";
import { CONFIG_FILE } from "src/constants";

export const LEGACY_CONFIG_ALIASES: Record<
  string,
  { category: string; name: string }
> = {
  "security.sessionDuration": { category: "general", name: "sessionDuration" },
  "security.secureCookies": { category: "general", name: "secureCookies" },
  "security.enableEmailVerification": {
    category: "email",
    name: "enableEmailVerification",
  },
  "security.allowRegistration": {
    category: "share",
    name: "allowRegistration",
  },
  "security.allowUnauthenticatedShares": {
    category: "share",
    name: "allowUnauthenticatedShares",
  },
  "security.allowAdminAccessAllShares": {
    category: "share",
    name: "allowAdminAccessAllShares",
  },
  "share.enableShareEmailRecipients": {
    category: "email",
    name: "enableShareEmailRecipients",
  },
  "share.enableShareDownloadNotifications": {
    category: "email",
    name: "enableShareDownloadNotifications",
  },
};

/**
 * ConfigService extends EventEmitter to allow listening for config updates,
 * now only `update` event will be emitted.
 */
@Injectable()
export class ConfigService extends EventEmitter {
  yamlConfig?: YamlConfig;
  logger = new Logger(ConfigService.name);
  // `get()` runs several times per request. Rebuild the key lookup only when
  // the array is replaced (config reload), not on every linear scan.
  private configLookup?: {
    variables: Config[];
    byKey: Map<string, Config>;
  };

  constructor(
    @Inject("CONFIG_VARIABLES") private configVariables: Config[],
    private prisma: PrismaService,
  ) {
    super();
  }

  private findConfigVariable(key: string): Config | undefined {
    if (this.configLookup?.variables !== this.configVariables) {
      this.configLookup = {
        variables: this.configVariables,
        byKey: new Map(
          this.configVariables.map((variable) => [
            `${variable.category}.${variable.name}`,
            variable,
          ]),
        ),
      };
    }
    return this.configLookup.byKey.get(key);
  }

  // Initialize gets called by the ConfigModule
  async initialize() {
    await this.loadYamlConfig();

    this.applyEnvOverrides();

    if (this.yamlConfig) {
      await this.migrateInitUser();
    }
  }

  private applyEnvOverrides() {
    // Environment variables take precedence over config.yaml and the database
    this.applyEnvOverride("general.appName", process.env.SITE_NAME?.trim());

    const cacheEnabled = process.env.CACHE_REDIS_ENABLED?.trim().toLowerCase();
    if (cacheEnabled !== undefined) {
      this.applyEnvOverride(
        "cache.redis-enabled",
        cacheEnabled === "true" ? "true" : "false",
      );
    }
    this.applyEnvOverride(
      "cache.redis-url",
      process.env.CACHE_REDIS_URL?.trim(),
    );
  }

  private applyEnvOverride(key: string, value?: string) {
    if (!value) return;

    const variable = this.findConfigVariable(key);
    if (!variable) return;

    variable.value = value;
    this.emit("update", key, value);
  }

  private async loadYamlConfig() {
    let configFile: string = "";
    try {
      configFile = fs.readFileSync(CONFIG_FILE, "utf8");
    } catch {
      this.logger.log(
        "Config.yaml is not set. Falling back to UI configuration.",
      );
    }
    try {
      this.yamlConfig = yamlParse(configFile);

      if (this.yamlConfig) {
        for (const configVariable of this.configVariables) {
          const currentKey = `${configVariable.category}.${configVariable.name}`;
          const category = this.yamlConfig[configVariable.category];
          let val = category?.[configVariable.name];

          if (val === undefined && LEGACY_CONFIG_ALIASES[currentKey]) {
            const legacy = LEGACY_CONFIG_ALIASES[currentKey];
            const legacyVal = this.yamlConfig[legacy.category]?.[legacy.name];
            if (legacyVal !== undefined) {
              val = legacyVal;
              this.logger.warn(
                this.t(
                  "config.deprecatedVariable",
                  "Config variable '{legacyKey}' is deprecated. Please move it to '{modernKey}' in your config.yaml",
                  {
                    legacyKey: `${legacy.category}.${legacy.name}`,
                    modernKey: `${configVariable.category}.${configVariable.name}`,
                  },
                ),
              );
            }
          }

          if (val !== undefined) {
            configVariable.value = val === null ? null : String(val);
            this.emit(
              "update",
              `${configVariable.category}.${configVariable.name}`,
              configVariable.value,
            );
          }
        }
      }
    } catch {
      this.logger.error(
        // Do not log the parser payload: a malformed line can contain SMTP,
        // OAuth or S3 secrets and this message is stored in the admin log.
        "Failed to parse config.yaml. Falling back to UI configuration.",
      );
    }
  }

  private async migrateInitUser(): Promise<void> {
    if (!this.yamlConfig.initUser?.enabled) return;

    const [adminCount, existingInitUser] = await Promise.all([
      this.prisma.user.count({ where: { isAdmin: true } }),
      this.prisma.user.findFirst({
        where: {
          OR: [
            { email: this.yamlConfig.initUser.email },
            { username: this.yamlConfig.initUser.username },
          ],
        },
        select: { id: true },
      }),
    ]);
    // Any existing admin means setup has already happened. Also skip when the
    // configured init account exists but was created as a non-admin; retrying
    // would only hit the unique email/username constraint on every start.
    if (adminCount >= 1 || existingInitUser) {
      this.logger.log(
        "Skip initial user creation. Admin user is already existent.",
      );
      return;
    }
    await this.prisma.user.create({
      data: {
        email: this.yamlConfig.initUser.email,
        username: this.yamlConfig.initUser.username,
        password: this.yamlConfig.initUser.password
          ? await argon.hash(this.yamlConfig.initUser.password)
          : null,
        isAdmin: this.yamlConfig.initUser.isAdmin,
      },
    });
  }

  get(key: `${string}.${string}`): any {
    const configVariable = this.findConfigVariable(key);

    if (!configVariable) throw new Error(`Config variable ${key} not found`);

    let value = configVariable.value ?? configVariable.defaultValue;

    // Every consumer concatenates paths or builds an origin from this value.
    // Normalize here as well so a config.yaml/legacy row with a trailing slash
    // cannot produce `//share/...`.
    if (key === "general.appUrl" && typeof value === "string")
      value = value.trim().replace(/\/+$/, "");

    if (configVariable.type == "number" || configVariable.type == "filesize")
      return parseInt(value);
    if (configVariable.type == "boolean") return value == "true";
    if (configVariable.type == "string" || configVariable.type == "text")
      return value;
    if (configVariable.type == "timespan") return stringToTimespan(value);
  }

  async getByCategory(category: string) {
    const configVariables = this.configVariables
      .filter((c) => !c.locked && category == c.category)
      .sort((a, b) => a.order - b.order);

    return configVariables.map((variable) => {
      return {
        ...variable,
        key: `${variable.category}.${variable.name}`,
        value: variable.value ?? variable.defaultValue,
        allowEdit: this.isEditAllowed(),
      };
    });
  }

  async list() {
    const configVariables = this.configVariables.filter((c) => !c.secret);

    return configVariables.map((variable) => {
      return {
        ...variable,
        key: `${variable.category}.${variable.name}`,
        value: variable.value ?? variable.defaultValue,
      };
    });
  }

  async updateMany(data: { key: string; value: string | number | boolean }[]) {
    if (!this.isEditAllowed())
      throw new BadRequestException(
        this.t(
          "config.editNotAllowed",
          "You are only allowed to update config variables via the config.yaml file",
        ),
      );

    const response: Config[] = [];

    for (const variable of data) {
      response.push(await this.update(variable.key, variable.value, false));
    }

    // Reload the in-memory config once for the whole batch instead of running
    // a full table read after every single variable.
    this.configVariables = await this.prisma.config.findMany();
    this.applyEnvOverrides();

    return response;
  }

  async update(key: string, value: string | number | boolean, reload = true) {
    if (!this.isEditAllowed())
      throw new BadRequestException(
        this.t(
          "config.editNotAllowed",
          "You are only allowed to update config variables via the config.yaml file",
        ),
      );

    const [category, name] = key.split(".");
    // The config table is loaded into memory at startup and kept in sync by
    // this service, so validating from memory avoids a query per variable.
    const configVariable = this.findConfigVariable(key);

    if (!configVariable || configVariable.locked)
      throw new NotFoundException(
        this.t("config.variableNotFound", "Config variable not found"),
      );

    // The public URL is concatenated with paths and stored in every email.
    // Normalize it once so a trailing slash cannot produce `//share/...`.
    if (key === "general.appUrl" && typeof value === "string")
      value = value.trim().replace(/\/+$/, "");

    if (value === "") {
      value = null;
    } else if (
      typeof value != configVariable.type &&
      typeof value == "string" &&
      configVariable.type != "text" &&
      configVariable.type != "timespan"
    ) {
      throw new BadRequestException(
        this.t("config.invalidType", "Config variable must be of type {type}", {
          type: configVariable.type,
        }),
      );
    }

    this.validateConfigVariable(key, value);

    const updatedVariable = await this.prisma.config.update({
      where: {
        name_category: { category, name },
      },
      data: { value: value === null ? null : value.toString() },
    });

    if (reload) {
      this.configVariables = await this.prisma.config.findMany();
      this.applyEnvOverrides();
    }

    this.emit("update", key, value);

    return updatedVariable;
  }

  validateConfigVariable(key: string, value: string | number | boolean) {
    const validations = [
      {
        key: "share.shareIdLength",
        // Keep this in step with CreateShareDTO's @Length(3, 50); a shorter
        // configured value would generate ids the create endpoint rejects.
        condition: (value: unknown) =>
          typeof value === "number" && value >= 3 && value <= 50,
        message: this.t(
          "config.shareIdLengthValidation",
          "Share ID length must be between 3 and 50",
        ),
      },
      {
        key: "share.zipCompressionLevel",
        condition: (value: unknown) =>
          typeof value === "number" && value >= 0 && value <= 9,
        message: this.t(
          "config.zipCompressionLevelValidation",
          "Zip compression level must be between 0 and 9",
        ),
      },
      {
        key: "oauth.allowedHosts",
        condition: (value: unknown) => {
          if (typeof value !== "string" || !value) return true;
          return value.split(",").every((h) => {
            const trimmed = h.trim();
            return !trimmed.includes("://") && !trimmed.includes("/");
          });
        },
        message: this.t(
          "config.oauthAllowedHostsValidation",
          "Allowed hosts must be a comma-separated list of hostnames without protocol or paths (e.g. share.internal.example.com)",
        ),
      },
      // TODO add validation for timespan type
    ];

    const validation = validations.find((validation) => validation.key == key);
    if (validation && !validation.condition(value)) {
      throw new BadRequestException(validation.message);
    }
  }

  isEditAllowed(): boolean {
    return this.yamlConfig === undefined || this.yamlConfig === null;
  }

  private t(
    key: string,
    fallback: string,
    args?: Record<string, string | number | boolean>,
  ) {
    const translated = I18nContext.current()?.t(key, { args });
    if (translated && translated !== key) return translated;

    return Object.entries(args ?? {}).reduce(
      (message, [argKey, value]) =>
        message.replaceAll(`{${argKey}}`, String(value)),
      fallback,
    );
  }
}
