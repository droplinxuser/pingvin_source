const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const {
  isArchiveFileName,
  isEncryptedArchive,
} = require("../dist/src/virustotal/archiveEncryption.util.js");
const {
  VirusTotalService,
} = require("../dist/src/virustotal/virustotal.service.js");

const bufferReader = (buffer) => async (start, end) =>
  buffer.subarray(start, Math.min(end + 1, buffer.length));

function zipArchive(encrypted) {
  const name = Buffer.from("secret.txt");
  const data = Buffer.from("payload");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(encrypted ? 1 : 0, 6);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const localRecord = Buffer.concat([local, name, data]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(encrypted ? 1 : 0, 8);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  const centralRecord = Buffer.concat([central, name]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralRecord.length, 12);
  eocd.writeUInt32LE(localRecord.length, 16);
  return Buffer.concat([localRecord, centralRecord, eocd]);
}

function sevenZArchive(encrypted) {
  const header = encrypted
    ? Buffer.from([0x24, 0x06, 0xf1, 0x07, 0x01, 0x00])
    : Buffer.from([0x01, 0x00]);
  const buffer = Buffer.alloc(32 + header.length);
  Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]).copy(buffer, 0);
  buffer[7] = 4;
  buffer.writeBigUInt64LE(0n, 12);
  buffer.writeBigUInt64LE(BigInt(header.length), 20);
  header.copy(buffer, 32);
  return buffer;
}

function rar4Archive(encrypted, headersEncrypted = false) {
  const signature = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]);
  const main = Buffer.alloc(13);
  main[2] = 0x73;
  main.writeUInt16LE(headersEncrypted ? 0x0080 : 0, 3);
  main.writeUInt16LE(13, 5);

  const file = Buffer.alloc(32);
  file[2] = 0x74;
  file.writeUInt16LE(0x8000 | (encrypted ? 0x0004 : 0), 3);
  file.writeUInt16LE(32, 5);
  return Buffer.concat([signature, main, file]);
}

function vint(value) {
  const bytes = [];
  while (value >= 0x80) {
    bytes.push((value & 0x7f) | 0x80);
    value = Math.floor(value / 128);
  }
  bytes.push(value);
  return Buffer.from(bytes);
}

function rar5Block(type, flags, body) {
  const header = Buffer.concat([vint(type), vint(flags), body]);
  return Buffer.concat([Buffer.alloc(4), vint(header.length), header]);
}

function rar5Archive(encrypted, headersEncrypted = false) {
  const signature = Buffer.from([
    0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00,
  ]);
  if (headersEncrypted)
    return Buffer.concat([signature, rar5Block(4, 0, Buffer.alloc(0))]);

  const main = rar5Block(1, 0, vint(0));
  const encryptionRecord = Buffer.concat([vint(1), vint(1)]);
  const body = encrypted
    ? Buffer.concat([
        vint(encryptionRecord.length),
        vint(0),
        vint(0),
        vint(0),
        vint(0),
        vint(0),
        vint(1),
        Buffer.from("a"),
        encryptionRecord,
      ])
    : Buffer.concat([
        vint(0),
        vint(0),
        vint(0),
        vint(0),
        vint(0),
        vint(1),
        Buffer.from("a"),
      ]);
  return Buffer.concat([
    signature,
    main,
    rar5Block(2, encrypted ? 1 : 0, body),
  ]);
}

test("recognises archive extensions", () => {
  for (const name of ["a.zip", "a.ZIP", "a.zipx", "a.7z", "a.rar"])
    assert.equal(isArchiveFileName(name), true, name);
  for (const name of ["a.txt", "a.pdf", "a.7z.txt", "archive"])
    assert.equal(isArchiveFileName(name), false, name);
});

test("detects encrypted ZIP, 7z, RAR4 and RAR5 archives", async () => {
  const cases = [
    [zipArchive(false), "a.zip", false],
    [zipArchive(true), "a.zip", true],
    [sevenZArchive(false), "a.7z", false],
    [sevenZArchive(true), "a.7z", true],
    [rar4Archive(false), "a.rar", false],
    [rar4Archive(true), "a.rar", true],
    [rar4Archive(false, true), "a.rar", true],
    [rar5Archive(false), "a.rar", false],
    [rar5Archive(true), "a.rar", true],
    [rar5Archive(false, true), "a.rar", true],
  ];

  for (const [buffer, name, expected] of cases)
    assert.equal(
      await isEncryptedArchive(name, buffer.length, bufferReader(buffer)),
      expected,
      name,
    );
});

test("skips encrypted archives before adding a VirusTotal job", async () => {
  const encryptedZip = zipArchive(true);
  const plainText = Buffer.from("not an archive");
  const files = new Map([
    ["zip-file", encryptedZip],
    ["text-file", plainText],
  ]);
  const jobs = [];
  const events = [];
  const service = new VirusTotalService(
    {
      get: async (_shareId, fileId, range) => ({
        file: Readable.from([
          files
            .get(fileId)
            .subarray(
              range.start,
              Math.min(range.end + 1, files.get(fileId).length),
            ),
        ]),
      }),
    },
    {},
    {},
    { recordEvent: (event) => events.push(event) },
    { push: async (job) => jobs.push(job) },
    {},
  );
  service.running = true;

  await service.enqueue("share-1", [
    {
      id: "zip-file",
      name: "secret.zip",
      size: String(encryptedZip.length),
    },
    {
      id: "text-file",
      name: "notes.txt",
      size: String(plainText.length),
    },
  ]);

  assert.deepEqual(
    jobs.map((job) => job.name),
    ["notes.txt"],
  );
  const skipped = events.find((event) => event.type === "skipped");
  assert.ok(skipped);
  assert.match(skipped.detail, /Password-protected archive/);
  assert.equal(skipped.fileName, "secret.zip");
});
