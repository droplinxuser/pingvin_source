import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { User } from "@prisma/client";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import { I18nService } from "nestjs-i18n";
import { join } from "path";
import { SHARE_DIRECTORY } from "../constants";
import { writeFileAtomic } from "../utils/fileWrite.util";
import { KeyedLock } from "../utils/keyedLock.util";
import { parsePagination } from "../utils/pagination.util";

const FILE_NAME = "comments.json";
// Keep the file small: comments are a convenience, not an archive.
const MAX_COMMENTS = 500;
export const MAX_COMMENT_LENGTH = 1000;
export const COMMENTS_PAGE_SIZE = 20;
// A month at the edge. The version in the share data keeps new comments from
// being hidden behind an old cached URL.
export const COMMENTS_EDGE_CACHE_SECONDS = 30 * 24 * 60 * 60;

// Bare domains are only stripped when they use a known public suffix. This
// avoids turning ordinary words such as "node.js" into empty comments.
const PUBLIC_SUFFIXES =
  "com|net|org|edu|gov|mil|int|info|biz|name|pro|app|dev|io|co|ai|me|tv|xyz|" +
  "online|site|store|shop|blog|club|live|link|top|vip|icu|fun|space|website|" +
  "tech|cloud|page|one|mobi|asia|travel|jobs|cat|tel|uk|de|fr|ru|cn|jp|br|in|" +
  "it|nl|se|no|es|ca|au|ch|at|be|dk|fi|pl|pt|gr|cz|ro|hu|ie|nz|sg|hk|kr|tw|" +
  "mx|ar|cl|za|tr|ua|id|my|ph|th|vn";

const URL_PATTERN = new RegExp(
  String.raw`\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b|` +
    String.raw`\b(?:https?:\/\/|ftps?:\/\/|mailto:|tel:|www\.)[^\s<>"']+|` +
    String.raw`\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:${PUBLIC_SUFFIXES})\b(?:[\/?#][^\s<>"']*)?`,
  "gi",
);

export type ShareComment = {
  id: string;
  userId: string;
  username: string;
  displayName?: string;
  content: string;
  createdAt: string;
};

type CommentFile = {
  version: number;
  comments: ShareComment[];
};

export type ShareCommentPage = {
  comments: ShareComment[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  version: number;
};

type CommentMutation = {
  version: number;
  total: number;
};

const logger = new Logger("ShareComments");

/**
 * Comments are plaintext. Links, HTML tags and control characters are removed
 * before a comment is stored and again before it is returned, so old or
 * hand-edited files can never put markup or clickable URLs on the page.
 */
export function sanitizeCommentContent(input: unknown): string {
  if (typeof input !== "string") return "";

  const text = input
    // Pasted text can contain binary control bytes; keep newlines and tabs.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(URL_PATTERN, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text.length > MAX_COMMENT_LENGTH
    ? text.slice(0, MAX_COMMENT_LENGTH).trim()
    : text;
}

function getCommentPath(shareId: string): string | null {
  // Keep malformed IDs from escaping the shares directory.
  return /^[\w-]+$/.test(shareId)
    ? join(SHARE_DIRECTORY, shareId, FILE_NAME)
    : null;
}

function toComment(value: unknown): ShareComment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const source = value as Record<string, unknown>;
  const content = sanitizeCommentContent(source.content);
  if (!content) return null;

  const pick = (field: string) =>
    typeof source[field] === "string" ? (source[field] as string) : undefined;
  const displayName = pick("displayName")?.trim();

  return {
    id: pick("id") ?? randomUUID(),
    userId: pick("userId") ?? "",
    username: pick("username") ?? "",
    displayName: displayName || undefined,
    content,
    createdAt: pick("createdAt") ?? new Date().toISOString(),
  };
}

function parseCommentFile(value: unknown): CommentFile {
  // Accept a bare array from an older/hand-written file.
  const source = Array.isArray(value)
    ? { comments: value }
    : value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const comments = Array.isArray(source.comments)
    ? source.comments
        .map(toComment)
        .filter((comment): comment is ShareComment => !!comment)
        .slice(-MAX_COMMENTS)
    : [];
  const version =
    typeof source.version === "number" &&
    Number.isSafeInteger(source.version) &&
    source.version >= 0
      ? source.version
      : comments.length;

  return { version, comments };
}

async function readCommentFile(shareId: string): Promise<CommentFile> {
  const path = getCommentPath(shareId);
  if (!path) return { version: 0, comments: [] };

  try {
    return parseCommentFile(JSON.parse(await fs.readFile(path, "utf8")));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      logger.warn(`Failed to read comments for share ${shareId}: ${error}`);
    }
    return { version: 0, comments: [] };
  }
}

/**
 * Lightweight version lookup for the share payload. It changes on every
 * create/edit/delete and is used as the `v` cache key of the listing.
 */
export async function readCommentVersion(shareId: string): Promise<number> {
  const path = getCommentPath(shareId);
  if (!path) return 0;

  try {
    const raw = JSON.parse(await fs.readFile(path, "utf8")) as
      | Record<string, unknown>
      | unknown[];
    if (Array.isArray(raw)) return raw.length;
    if (!raw || typeof raw !== "object") return 0;

    const version = (raw as Record<string, unknown>).version;
    if (
      typeof version === "number" &&
      Number.isSafeInteger(version) &&
      version >= 0
    )
      return version;

    const comments = (raw as Record<string, unknown>).comments;
    return Array.isArray(comments) ? comments.length : 0;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      logger.warn(
        `Failed to read the comment version for share ${shareId}: ${error}`,
      );
    }
    return 0;
  }
}

@Injectable()
export class CommentService {
  private readonly locks = new KeyedLock();

  constructor(private readonly i18n: I18nService) {}

  async list(shareId: string, page = "1"): Promise<ShareCommentPage> {
    const file = await readCommentFile(shareId);
    const total = file.comments.length;
    const totalPages = Math.ceil(total / COMMENTS_PAGE_SIZE);
    const requested = parsePagination(page, String(COMMENTS_PAGE_SIZE));
    const pageNum = totalPages === 0 ? 1 : Math.min(requested.page, totalPages);
    const start = (pageNum - 1) * COMMENTS_PAGE_SIZE;

    return {
      // Newest first; the file itself stays append-only.
      comments: [...file.comments]
        .reverse()
        .slice(start, start + COMMENTS_PAGE_SIZE),
      total,
      page: pageNum,
      pageSize: COMMENTS_PAGE_SIZE,
      totalPages,
      version: file.version,
    };
  }

  async create(
    shareId: string,
    user: User,
    content: string,
  ): Promise<{ comment: ShareComment } & CommentMutation> {
    const clean = this.cleanContent(content);
    const path = getCommentPath(shareId);
    if (!path)
      throw new BadRequestException(this.i18n.t("file.invalidIdFormat"));

    return this.withLock(shareId, async () => {
      const file = await readCommentFile(shareId);
      const comment: ShareComment = {
        id: randomUUID(),
        userId: user.id,
        username: user.username,
        displayName: user.displayName?.trim() || undefined,
        content: clean,
        createdAt: new Date().toISOString(),
      };

      file.comments = [...file.comments, comment].slice(-MAX_COMMENTS);
      file.version += 1;
      await this.write(path, file);

      return {
        comment,
        version: file.version,
        total: file.comments.length,
      };
    });
  }

  async update(
    shareId: string,
    commentId: string,
    user: User,
    content: string,
  ): Promise<{ comment: ShareComment } & CommentMutation> {
    const clean = this.cleanContent(content);
    const path = getCommentPath(shareId);
    if (!path)
      throw new BadRequestException(this.i18n.t("file.invalidIdFormat"));

    return this.withLock(shareId, async () => {
      const file = await readCommentFile(shareId);
      const comment = file.comments.find((item) => item.id === commentId);
      this.assertCanManage(comment, user);

      comment.content = clean;
      comment.username = user.username;
      comment.displayName = user.displayName?.trim() || undefined;
      file.version += 1;
      await this.write(path, file);

      return {
        comment,
        version: file.version,
        total: file.comments.length,
      };
    });
  }

  async remove(
    shareId: string,
    commentId: string,
    user: User,
  ): Promise<CommentMutation> {
    const path = getCommentPath(shareId);
    if (!path)
      throw new BadRequestException(this.i18n.t("file.invalidIdFormat"));

    return this.withLock(shareId, async () => {
      const file = await readCommentFile(shareId);
      const comment = file.comments.find((item) => item.id === commentId);
      this.assertCanManage(comment, user);

      file.comments = file.comments.filter((item) => item.id !== commentId);
      file.version += 1;
      await this.write(path, file);

      return { version: file.version, total: file.comments.length };
    });
  }

  private cleanContent(content: string) {
    const clean = sanitizeCommentContent(content);
    if (!clean) {
      throw new BadRequestException(
        this.i18n.t(
          content.trim() ? "share.commentsOnlyLinks" : "share.commentsEmpty",
        ),
      );
    }
    return clean;
  }

  private assertCanManage(comment: ShareComment | undefined, user: User) {
    if (!comment)
      throw new NotFoundException(this.i18n.t("share.commentsNotFound"));
    if (comment.userId !== user.id && !user.isAdmin)
      throw new ForbiddenException(this.i18n.t("share.commentsForbidden"));
  }

  private async write(path: string, file: CommentFile) {
    // A missing share directory is expected after an expiry/cleanup task; the
    // atomic write fails with ENOENT and never recreates the directory.
    await writeFileAtomic(path, JSON.stringify(file));
  }

  private withLock<T>(shareId: string, task: () => Promise<T>): Promise<T> {
    return this.locks.run(shareId, task);
  }
}
