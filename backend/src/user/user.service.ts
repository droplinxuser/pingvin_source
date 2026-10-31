import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import * as argon from "argon2";
import * as crypto from "crypto";
import { Entry } from "ldapts";
import { I18nService } from "nestjs-i18n";
import { AuthSignInDTO } from "src/auth/dto/authSignIn.dto";
import { EmailService } from "src/email/email.service";
import { PrismaService } from "src/prisma/prisma.service";
import { inspect } from "util";
import { ConfigService } from "../config/config.service";
import { FileService } from "../file/file.service";
import { tableOrderBy } from "../utils/pagination.util";
import { AvatarService } from "./avatar.service";
import { CreateUserDTO } from "./dto/createUser.dto";
import { UpdateUserDto } from "./dto/updateUser.dto";

const USER_SORT_FIELDS = {
  displayName: "displayName",
  username: "username",
  email: "email",
  isAdmin: "isAdmin",
  createdAt: "createdAt",
} as const;

// These quota columns are stored as decimal strings. Sorting them with Prisma
// would be lexicographic ("9" after "10"), so they are ordered with SQLite's
// numeric CAST instead of loading every user into memory.
const USER_NUMERIC_SORT_FIELDS = {
  storageQuotaLimit: Prisma.raw('"storageQuotaLimit"'),
  shareSizeLimit: Prisma.raw('"shareSizeLimit"'),
} as const;

// The admin table only displays these fields, so secrets such as password
// hashes and TOTP data never leave the database for list requests.
const USER_SELECT = {
  id: true,
  username: true,
  email: true,
  displayName: true,
  avatarUpdatedAt: true,
  isAdmin: true,
  isActivated: true,
  ldapDN: true,
  shareSizeLimit: true,
  storageQuotaLimit: true,
  allowShare: true,
  allowCreateReverseShares: true,
  maxShares: true,
  maxReverseShares: true,
  totpVerified: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UserSevice {
  private readonly logger = new Logger(UserSevice.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private fileService: FileService,
    private avatarService: AvatarService,
    private configService: ConfigService,
    private readonly i18n: I18nService,
  ) {}

  async list(
    take?: number,
    skip?: number,
    sortBy?: string,
    sortDirection?: string,
  ) {
    if (sortBy === "storageQuotaLimit" || sortBy === "shareSizeLimit") {
      const column = USER_NUMERIC_SORT_FIELDS[sortBy];
      const direction = Prisma.raw(sortDirection === "asc" ? "ASC" : "DESC");
      // Keep unset quotas after numeric values in both directions, matching
      // the previous in-memory sort, and page in SQL.
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT "id"
        FROM "User"
        ORDER BY (${column} IS NULL) ASC,
                 CAST(${column} AS INTEGER) ${direction},
                 "id" ASC
        LIMIT ${take ?? 20} OFFSET ${skip ?? 0}
      `;
      if (rows.length === 0) return [];

      const users = await this.prisma.user.findMany({
        where: { id: { in: rows.map((row) => row.id) } },
        select: USER_SELECT,
      });
      const byId = new Map(users.map((user) => [user.id, user]));
      return rows.flatMap(({ id }) => {
        const user = byId.get(id);
        return user ? [user] : [];
      });
    }

    return await this.prisma.user.findMany({
      take,
      skip,
      select: USER_SELECT,
      orderBy: tableOrderBy(USER_SORT_FIELDS, sortBy, sortDirection) ?? {
        createdAt: "desc",
      },
    });
  }

  async count() {
    return await this.prisma.user.count();
  }

  async get(id: string) {
    return await this.prisma.user.findUnique({ where: { id } });
  }

  async create(dto: CreateUserDTO) {
    let hash: string;
    let randomPassword: string;

    if (
      typeof dto.password === "string" &&
      !(await this.enforcePasswordPolicy(dto.password))
    ) {
      throw new BadRequestException(this.i18n.t("auth.passwordPolicyNotMet"));
    }

    // The password can be undefined only when an invite email can be sent.
    if (!dto.password) {
      if (!this.configService.get("smtp.enabled")) {
        throw new BadRequestException(
          this.i18n.t("auth.passwordRequiredWithoutSmtp"),
        );
      }
      randomPassword = crypto.randomUUID();
      hash = await argon.hash(randomPassword);
    } else {
      hash = await argon.hash(dto.password);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            ...dto,
            displayName: dto.displayName?.trim() || null,
            password: hash,
          },
        });

        if (randomPassword) {
          await this.emailService.sendInviteEmail(
            dto.email,
            randomPassword,
            user.displayName || user.username,
          );
        }

        return user;
      });
    } catch (e) {
      if (e instanceof PrismaClientKnownRequestError) {
        if (e.code == "P2002") {
          const duplicatedField: string = e.meta.target[0];
          throw new BadRequestException(
            this.i18n.t("auth.userAlreadyExists", {
              args: { field: duplicatedField },
            }),
          );
        }
      }
      throw e;
    }
  }

  async update(id: string, user: UpdateUserDto) {
    try {
      if (
        typeof user.password === "string" &&
        !(await this.enforcePasswordPolicy(user.password))
      ) {
        throw new BadRequestException(this.i18n.t("auth.passwordPolicyNotMet"));
      }

      // Deleting the last admin is blocked; demoting the last one has the same
      // effect (nobody can reach the admin UI or restore access).
      if (user.isAdmin === false) {
        const target = await this.prisma.user.findUnique({
          where: { id },
          select: { isAdmin: true },
        });
        if (target?.isAdmin) {
          const adminCount = await this.prisma.user.count({
            where: { isAdmin: true },
          });
          if (adminCount <= 1) {
            throw new BadRequestException(
              this.i18n.t("auth.cannotDemoteLastAdmin"),
            );
          }
        }
      }

      const hash = user.password && (await argon.hash(user.password));
      const { displayName, isActivated, ...rest } = user;

      if (hash) {
        await this.prisma.refreshToken.deleteMany({
          where: { userId: id },
        });
      }

      return await this.prisma.user.update({
        where: { id },
        data: {
          ...rest,
          ...(displayName !== undefined && {
            displayName: displayName?.trim() || null,
          }),
          ...(isActivated === true && {
            isActivated: true,
            activationToken: null,
            activationTokenExpiresAt: null,
          }),
          password: hash,
        },
      });
    } catch (e) {
      if (e instanceof PrismaClientKnownRequestError) {
        if (e.code == "P2002") {
          const duplicatedField: string = e.meta.target[0];
          throw new BadRequestException(
            this.i18n.t("auth.userAlreadyExists", {
              args: { field: duplicatedField },
            }),
          );
        }
      }
      throw e;
    }
  }

  async delete(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        isAdmin: true,
        shares: { select: { id: true } },
        // Shares uploaded through the user's reverse shares have no creatorId,
        // so they are not in `shares`; deleting the account must still remove
        // their bytes instead of orphaning them on disk/S3 forever.
        reverseShares: {
          select: { shares: { select: { id: true } } },
        },
      },
    });
    if (!user) throw new BadRequestException(this.i18n.t("auth.userNotFound"));

    if (user.isAdmin) {
      const userCount = await this.prisma.user.count({
        where: { isAdmin: true },
      });

      if (userCount === 1) {
        throw new BadRequestException(
          this.i18n.t("auth.cannotDeleteLastAdmin"),
        );
      }
    }

    const shareIds = new Set([
      ...user.shares.map((share) => share.id),
      ...user.reverseShares.flatMap((reverseShare) =>
        reverseShare.shares.map((share) => share.id),
      ),
    ]);
    await Promise.all([
      ...[...shareIds].map((shareId) =>
        this.fileService.deleteAllFiles(shareId),
      ),
      this.avatarService.deleteFile(id),
    ]);

    return await this.prisma.user.delete({ where: { id } });
  }

  async findOrCreateFromLDAP(
    providedCredentials: AuthSignInDTO,
    ldapEntry: Entry,
  ) {
    const fieldNameMemberOf = this.configService.get("ldap.fieldNameMemberOf");
    const fieldNameEmail = this.configService.get("ldap.fieldNameEmail");
    const fieldNameDisplayName = this.configService.get(
      "ldap.fieldNameDisplayName",
    );

    let isAdmin = false;
    if (fieldNameMemberOf in ldapEntry) {
      const adminGroup = this.configService.get("ldap.adminGroups");
      const entryGroups = Array.isArray(ldapEntry[fieldNameMemberOf])
        ? ldapEntry[fieldNameMemberOf]
        : [ldapEntry[fieldNameMemberOf]];
      isAdmin = entryGroups.includes(adminGroup) ?? false;
    } else {
      this.logger.warn(
        `Trying to create/update a ldap user but the member field ${fieldNameMemberOf} is not present.`,
      );
    }

    let userEmail: string | null = null;
    if (fieldNameEmail in ldapEntry) {
      const value = Array.isArray(ldapEntry[fieldNameEmail])
        ? ldapEntry[fieldNameEmail][0]
        : ldapEntry[fieldNameEmail];
      if (value) {
        userEmail = value.toString();
      }
    } else {
      this.logger.warn(
        `Trying to create/update a ldap user but the email field ${fieldNameEmail} is not present.`,
      );
    }

    let userDisplayName: string | null = null;
    if (fieldNameDisplayName in ldapEntry) {
      const value = Array.isArray(ldapEntry[fieldNameDisplayName])
        ? ldapEntry[fieldNameDisplayName][0]
        : ldapEntry[fieldNameDisplayName];
      if (value && value.toString().match(/^[\p{L} ,.'-]*$/u)) {
        userDisplayName = value.toString();
      }
    }

    if (providedCredentials.email && !userEmail) {
      /* if LDAP does not provides an users email address, take the user provided email address instead */
      userEmail = providedCredentials.email;
    }

    const randomId = crypto.randomUUID();
    const placeholderUsername = `ldap_user_${randomId}`;
    const placeholderEMail = `${randomId}@ldap.local`;

    try {
      const user = await this.prisma.user.upsert({
        create: {
          displayName: userDisplayName ?? null,
          username: providedCredentials.username ?? placeholderUsername,
          email: userEmail ?? placeholderEMail,
          password: await argon.hash(crypto.randomUUID()),

          isAdmin,
          ldapDN: ldapEntry.dn,
        },
        update: {
          isAdmin,
          ldapDN: ldapEntry.dn,
        },
        where: {
          ldapDN: ldapEntry.dn,
        },
      });

      if (user.username === placeholderUsername) {
        /* Give the user a human readable name if the user has been created with a placeholder username */
        await this.prisma.user
          .update({
            where: {
              id: user.id,
            },
            data: {
              username: `user_${user.id}`,
            },
          })
          .then((newUser) => {
            user.username = newUser.username;
          })
          .catch((error) => {
            this.logger.warn(
              `Failed to update users ${user.id} placeholder username: ${inspect(error)}`,
            );
          });
      }

      if (userEmail && userEmail !== user.email) {
        /* Sync users email if it has changed */
        await this.prisma.user
          .update({
            where: {
              id: user.id,
            },
            data: {
              email: userEmail,
            },
          })
          .then((newUser) => {
            this.logger.log(
              `Updated users ${user.id} email from ldap from ${user.email} to ${userEmail}.`,
            );
            user.email = newUser.email;
          })
          .catch((error) => {
            this.logger.error(
              `Failed to update users ${user.id} email to ${userEmail}: ${inspect(error)}`,
            );
          });
      }

      return user;
    } catch (e) {
      if (e instanceof PrismaClientKnownRequestError) {
        if (e.code == "P2002") {
          const duplicatedField: string = e.meta.target[0];
          throw new BadRequestException(
            this.i18n.t("auth.userAlreadyExists", {
              args: { field: duplicatedField },
            }),
          );
        }
      }
    }
  }

  async enforcePasswordPolicy(password: string): Promise<boolean> {
    const isCustom = this.configService.get("security.customPasswordPolicy");
    const minLength = isCustom
      ? this.configService.get("security.minLength")
      : 8;

    if (password.length < minLength) return false;

    if (!isCustom) return true;

    const requireUppercase = this.configService.get(
      "security.requireUppercase",
    );
    const requireLowercase = this.configService.get(
      "security.requireLowercase",
    );
    const requireNumber = this.configService.get("security.requireNumber");
    const requireSpecialCharacter = this.configService.get(
      "security.requireSpecialCharacter",
    );

    if (
      password.length < minLength ||
      (!password.match(/[A-Z]/) && requireUppercase) ||
      (!password.match(/[a-z]/) && requireLowercase) ||
      (!password.match(/[0-9]/) && requireNumber) ||
      (!password.match(/[^A-Za-z0-9]/) && requireSpecialCharacter)
    ) {
      return false;
    }

    return true;
  }
}
