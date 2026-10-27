const test = require("node:test");
const assert = require("node:assert/strict");
const { GUARDS_METADATA } = require("@nestjs/common/constants");
const { FileController } = require("../dist/src/file/file.controller.js");
const { ShareController } = require("../dist/src/share/share.controller.js");

const guardNames = (controller, method) =>
  (Reflect.getMetadata(GUARDS_METADATA, controller.prototype[method]) ?? []).map(
    (guard) => guard.name,
  );

// A reverse-share use is reserved when the share is created. The follow-up
// upload, complete, revert and file-removal routes must therefore not run
// CreateShareGuard again: its remaining-use check would reject a valid
// in-progress upload. StrictShareOwnerGuard matches the linked token instead.
test("upload, complete and removal routes do not re-check reverse-share uses", () => {
  for (const method of [
    "uploadInit",
    "uploadComplete",
    "uploadAbort",
    "create",
    "remove",
  ]) {
    const guards = guardNames(FileController, method);
    assert.equal(
      guards.includes("CreateShareGuard"),
      false,
      `FileController.${method} must not use CreateShareGuard`,
    );
    assert.equal(
      guards.includes("StrictShareOwnerGuard"),
      true,
      `FileController.${method} must keep StrictShareOwnerGuard`,
    );
  }

  for (const method of ["complete", "revertComplete"]) {
    const guards = guardNames(ShareController, method);
    assert.equal(
      guards.includes("CreateShareGuard"),
      false,
      `ShareController.${method} must not use CreateShareGuard`,
    );
    assert.equal(
      guards.includes("StrictShareOwnerGuard"),
      true,
      `ShareController.${method} must keep StrictShareOwnerGuard`,
    );
  }
});

test("share creation still validates a reverse-share token", () => {
  assert.equal(
    guardNames(ShareController, "create").includes("CreateShareGuard"),
    true,
  );
});
