const test = require("node:test");
const assert = require("node:assert/strict");
const { JobsService } = require("../dist/src/jobs/jobs.service.js");

test("deleting an unactivated user also removes reverse-share uploads", async () => {
  const deletedFiles = [];
  const deletedUsers = [];
  const prisma = {
    user: {
      findMany: async () => [
        {
          id: "user-1",
          shares: [{ id: "owned-share" }],
          reverseShares: [
            { shares: [{ id: "received-a" }, { id: "received-b" }] },
          ],
        },
      ],
      delete: async ({ where }) => {
        deletedUsers.push(where.id);
      },
    },
  };
  const fileService = {
    deleteAllFiles: async (shareId) => deletedFiles.push(shareId),
  };

  const service = new JobsService(prisma, {}, fileService, {});
  await service.deleteUnactivatedUsers();

  assert.deepEqual(deletedFiles.sort(), [
    "owned-share",
    "received-a",
    "received-b",
  ]);
  assert.deepEqual(deletedUsers, ["user-1"]);
});
