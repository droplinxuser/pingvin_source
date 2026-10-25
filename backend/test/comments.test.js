const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "pingvin-comments-"));
process.env.DATA_DIRECTORY = dataDirectory;

const {
  CommentService,
  readCommentVersion,
  sanitizeCommentContent,
} = require("../dist/src/share/comment.service.js");

const shareDirectory = path.join(
  dataDirectory,
  "uploads",
  "shares",
  "demo",
);
fs.mkdirSync(shareDirectory, { recursive: true });

const user = {
  id: "user-1",
  username: "alice",
  displayName: "Alice",
};

function createService() {
  return new CommentService({ t: (key) => key });
}

test("keeps plain text untouched", () => {
  assert.equal(
    sanitizeCommentContent("Great share, thanks!"),
    "Great share, thanks!",
  );
  assert.equal(
    sanitizeCommentContent("Check node.js, file.txt and version 3.14"),
    "Check node.js, file.txt and version 3.14",
  );
});

test("strips URLs, bare domains, email addresses and contact links", () => {
  assert.equal(
    sanitizeCommentContent("Visit https://example.com/file now"),
    "Visit now",
  );
  assert.equal(
    sanitizeCommentContent("See www.example.com and example.org/path?x=1"),
    "See and",
  );
  assert.equal(
    sanitizeCommentContent("mail test@example.com or mailto:test@example.com"),
    "mail or",
  );
  assert.equal(sanitizeCommentContent("https://only-link.example.com"), "");
});

test("strips markup and control characters", () => {
  assert.equal(
    sanitizeCommentContent("<b>Hello</b>\u0000 world"),
    "Hello world",
  );
});

test("normalizes excessive spacing without dropping line breaks", () => {
  assert.equal(
    sanitizeCommentContent("Line one\n\n\n\nLine two   end"),
    "Line one\n\nLine two end",
  );
});

test("stores comments beside uploader.json with a cache version", async () => {
  const service = createService();
  const result = await service.create(
    "demo",
    user,
    "Hello https://example.com world",
  );

  assert.equal(result.comment.content, "Hello world");
  assert.equal(result.comment.userId, "user-1");
  assert.equal(result.comment.username, "alice");
  assert.equal(result.comment.displayName, "Alice");
  assert.equal(result.version, 1);
  assert.equal(result.total, 1);
  assert.equal(await readCommentVersion("demo"), 1);

  const file = JSON.parse(
    fs.readFileSync(path.join(shareDirectory, "comments.json"), "utf8"),
  );
  assert.equal(file.version, 1);
  assert.deepEqual(Object.keys(file.comments[0]).sort(), [
    "content",
    "createdAt",
    "displayName",
    "id",
    "userId",
    "username",
  ]);

  const page = await service.list("demo", "1");
  assert.equal(page.total, 1);
  assert.equal(page.totalPages, 1);
  assert.equal(page.comments[0].content, "Hello world");
});

test("paginates newest first at twenty items per page", async () => {
  const service = createService();
  for (let index = 0; index < 25; index += 1) {
    await service.create("demo", user, `Comment ${index}`);
  }

  const first = await service.list("demo", "1");
  assert.equal(first.comments.length, 20);
  assert.equal(first.comments[0].content, "Comment 24");
  assert.equal(first.total, 26);
  assert.equal(first.totalPages, 2);

  const second = await service.list("demo", "2");
  assert.equal(second.comments.length, 6);
  assert.equal(second.comments[0].content, "Comment 4");

  const clamped = await service.list("demo", "99");
  assert.equal(clamped.page, 2);
  assert.equal(clamped.comments.length, 6);
});

test("rejects empty and link-only comments", async () => {
  const service = createService();
  await assert.rejects(
    () => service.create("demo", user, "https://example.com"),
    /share.commentsOnlyLinks/,
  );
  await assert.rejects(
    () => service.create("demo", user, "   "),
    /share.commentsEmpty/,
  );
});

test("serializes concurrent writes without losing comments", async () => {
  const service = createService();
  const before = await service.list("demo", "1");

  await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      service.create("demo", user, `Concurrent ${index}`),
    ),
  );

  const after = await service.list("demo", "1");
  assert.equal(after.total, before.total + 10);
  assert.equal(after.version, before.version + 10);
  assert.deepEqual(
    after.comments.slice(0, 10).map((comment) => comment.content).sort(),
    Array.from({ length: 10 }, (_, index) => `Concurrent ${index}`).sort(),
  );
});

test("lets authors and admins edit or delete comments", async () => {
  const shareId = "mutations";
  fs.mkdirSync(path.join(dataDirectory, "uploads", "shares", shareId), {
    recursive: true,
  });

  const service = createService();
  const bob = { id: "user-2", username: "bob", displayName: null };
  const admin = {
    id: "admin-1",
    username: "admin",
    displayName: "Admin",
    isAdmin: true,
  };

  const first = await service.create(shareId, user, "First comment");
  const second = await service.create(shareId, bob, "Second comment");

  await assert.rejects(
    () => service.update(shareId, first.comment.id, bob, "Hijacked"),
    /share.commentsForbidden/,
  );

  const updated = await service.update(
    shareId,
    first.comment.id,
    user,
    "Edited https://example.com",
  );
  assert.equal(updated.comment.content, "Edited");
  assert.equal(updated.version, 3);

  await assert.rejects(
    () => service.remove(shareId, second.comment.id, user),
    /share.commentsForbidden/,
  );

  const removed = await service.remove(shareId, second.comment.id, admin);
  assert.equal(removed.total, 1);
  assert.equal(removed.version, 4);
  assert.equal(await readCommentVersion(shareId), 4);

  await assert.rejects(
    () => service.update(shareId, "missing", user, "Nothing"),
    /share.commentsNotFound/,
  );
});

test("uses the username when a display name is unavailable", async () => {
  const shareId = "no-display-name";
  fs.mkdirSync(path.join(dataDirectory, "uploads", "shares", shareId), {
    recursive: true,
  });

  const service = createService();
  const result = await service.create(
    shareId,
    { id: "user-3", username: "carol", displayName: "" },
    "Fallback name",
  );

  assert.equal(result.comment.username, "carol");
  assert.equal(result.comment.displayName, undefined);
});

test.after(() => {
  fs.rmSync(dataDirectory, { recursive: true, force: true });
});
