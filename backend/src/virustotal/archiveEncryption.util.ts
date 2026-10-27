import { extname } from "path";

/**
 * Reads an inclusive byte range from a stored file. Returning `undefined`
 * means the range could not be read; callers treat that as "unknown" and let
 * the normal scan proceed rather than skipping a file on a storage error.
 */
export type ArchiveRangeReader = (
  start: number,
  end: number,
) => Promise<Buffer | undefined>;

// Archive headers and central directories are small in normal archives. A
// bounded read keeps a malformed or adversarial archive from making the
// detection pass consume a lot of memory or storage requests.
const MAX_CENTRAL_DIRECTORY_BYTES = 8 * 1024 * 1024;
const MAX_ZIP_TAIL_BYTES = 65_557; // EOCD (22) + maximum comment (65535)
const MAX_7Z_HEADER_BYTES = 4 * 1024 * 1024;
const MAX_RAR_HEADER_READS = 256;
const MAX_RAR_HEADER_BYTES = 2 * 1024 * 1024;
const MAX_RAR_BLOCK_READ = 64 * 1024;

const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP_ENCRYPTED_FLAG = 0x0001;
const ZIP_STRONG_ENCRYPTION_FLAG = 0x0040;
const ZIP_MASKED_HEADER_FLAG = 0x2000;
const ZIP64_EXTRA_FIELD = 0x0001;
const RAR4_HEAD_FLAG_LONG_BLOCK = 0x8000;
const RAR4_MAIN_HEADER = 0x73;
const RAR4_FILE_HEADER = 0x74;
const RAR4_MAIN_ENCRYPTION_FLAGS = 0x0080 | 0x0200;
const RAR4_FILE_ENCRYPTED_FLAG = 0x0004;
const RAR5_FILE_HEADER = 2;
const RAR5_SERVICE_HEADER = 3;
const RAR5_ENCRYPTION_HEADER = 4;
const RAR5_END_HEADER = 5;
const RAR5_HEADER_EXTRA_AREA = 0x0001;
const RAR5_HEADER_DATA_AREA = 0x0002;
const RAR5_FILE_ENCRYPTION_RECORD = 0x01;
const SEVEN_Z_SIGNATURE = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);
const RAR4_SIGNATURE = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]);
const RAR5_SIGNATURE = Buffer.from([
  0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00,
]);
const SEVEN_Z_AES_METHOD_ID = [0x06, 0xf1, 0x07, 0x01];

const ARCHIVE_EXTENSIONS = new Set([".zip", ".zipx", ".7z", ".rar"]);

export function isArchiveFileName(fileName: string): boolean {
  return ARCHIVE_EXTENSIONS.has(extname(fileName).toLowerCase());
}

/**
 * Detects password-protected ZIP/7z/RAR archives without extracting or
 * decrypting anything. The caller passes a range reader so the same logic
 * works for local files and S3 objects.
 *
 * Returns `true` only when an encryption flag is found. Malformed, truncated
 * or unsupported archives return `false` so the normal VirusTotal scan still
 * runs as a safe fallback.
 */
export async function isEncryptedArchive(
  fileName: string,
  size: number,
  readRange: ArchiveRangeReader,
): Promise<boolean> {
  if (!isArchiveFileName(fileName) || size <= 0) return false;

  try {
    const headLength = Math.min(size, 8);
    const head = await readRange(0, headLength - 1);
    if (!head) return false;

    if (head.subarray(0, SEVEN_Z_SIGNATURE.length).equals(SEVEN_Z_SIGNATURE))
      return await isEncrypted7z(size, readRange);
    if (head.subarray(0, RAR4_SIGNATURE.length).equals(RAR4_SIGNATURE))
      return await isEncryptedRar4(size, readRange);
    if (head.subarray(0, RAR5_SIGNATURE.length).equals(RAR5_SIGNATURE))
      return await isEncryptedRar5(size, readRange);

    // ZIP has no fixed signature at byte 0 (self-extracting archives have an
    // executable stub first), so use the EOCD record for the ZIP extension.
    const extension = extname(fileName).toLowerCase();
    if (extension === ".zip" || extension === ".zipx")
      return await isEncryptedZip(size, readRange);
  } catch {
    // A storage error must not disable scanning for the whole share.
  }

  return false;
}

async function isEncryptedZip(
  size: number,
  readRange: ArchiveRangeReader,
): Promise<boolean> {
  const tailLength = Math.min(size, MAX_ZIP_TAIL_BYTES);
  const tailStart = size - tailLength;
  const tail = await readRange(tailStart, size - 1);
  if (!tail || tail.length < 22) return false;

  let eocd = -1;
  for (let offset = tail.length - 22; offset >= 0; offset--) {
    if (tail.readUInt32LE(offset) !== ZIP_EOCD_SIGNATURE) continue;
    const commentLength = tail.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength <= tail.length) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) return false;

  let entryCount = tail.readUInt16LE(eocd + 10);
  let centralDirectorySize = tail.readUInt32LE(eocd + 12);
  let centralDirectoryOffset = tail.readUInt32LE(eocd + 16);

  if (
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    const locator = eocd - 20;
    if (locator < 0 || tail.readUInt32LE(locator) !== ZIP64_LOCATOR_SIGNATURE)
      return false;

    const zip64Offset = safeNumber(tail.readBigUInt64LE(locator + 8));
    if (zip64Offset === undefined) return false;

    const zip64 = await readRange(zip64Offset, zip64Offset + 55);
    if (
      !zip64 ||
      zip64.length < 56 ||
      zip64.readUInt32LE(0) !== ZIP64_EOCD_SIGNATURE
    )
      return false;

    entryCount = safeNumber(zip64.readBigUInt64LE(32)) ?? 0;
    centralDirectorySize =
      safeNumber(zip64.readBigUInt64LE(40)) ?? centralDirectorySize;
    centralDirectoryOffset =
      safeNumber(zip64.readBigUInt64LE(48)) ?? centralDirectoryOffset;
  }

  if (
    entryCount === 0 ||
    centralDirectorySize === 0 ||
    centralDirectoryOffset >= size
  )
    return false;

  const readSize = Math.min(centralDirectorySize, MAX_CENTRAL_DIRECTORY_BYTES);
  const centralDirectory = await readRange(
    centralDirectoryOffset,
    centralDirectoryOffset + readSize - 1,
  );
  if (
    !centralDirectory ||
    centralDirectory.length < 46 ||
    centralDirectory.readUInt32LE(0) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE
  )
    // A fully encrypted central directory cannot be parsed without the
    // password. The local file header still exposes the encryption flag.
    return await hasEncryptedZipLocalHeader(size, readRange);

  let offset = 0;
  while (offset + 46 <= centralDirectory.length) {
    if (
      centralDirectory.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE
    )
      return await hasEncryptedZipLocalHeader(size, readRange);

    const flags = centralDirectory.readUInt16LE(offset + 8);
    if (
      flags &
      (ZIP_ENCRYPTED_FLAG | ZIP_STRONG_ENCRYPTION_FLAG | ZIP_MASKED_HEADER_FLAG)
    )
      return true;

    const nameLength = centralDirectory.readUInt16LE(offset + 28);
    const extraLength = centralDirectory.readUInt16LE(offset + 30);
    const commentLength = centralDirectory.readUInt16LE(offset + 32);
    const entryLength = 46 + nameLength + extraLength + commentLength;
    if (entryLength < 46 || offset + entryLength > centralDirectory.length)
      return await hasEncryptedZipLocalHeader(size, readRange);

    // A ZIP64 entry can mark encryption in an extra field even when the
    // central-directory flag is missing on old writers.
    if (
      hasEncryptedZipExtraField(
        centralDirectory.subarray(
          offset + 46 + nameLength,
          offset + 46 + nameLength + extraLength,
        ),
      )
    )
      return true;

    offset += entryLength;
  }

  return false;
}

function hasEncryptedZipExtraField(extra: Buffer): boolean {
  let offset = 0;
  while (offset + 4 <= extra.length) {
    const headerId = extra.readUInt16LE(offset);
    const dataSize = extra.readUInt16LE(offset + 2);
    offset += 4 + dataSize;
    if (offset > extra.length) break;
    if (headerId === ZIP64_EXTRA_FIELD) continue;
    // AES/WinZip encryption uses extra field 0x9901. The central-directory
    // encryption flag is normally set as well; this is a defensive fallback.
    if (headerId === 0x9901) return true;
  }
  return false;
}

/**
 * Reads the first local file header. This is the fallback for ZIPs whose
 * central directory is encrypted, and for self-extracting ZIPs where the
 * local header sits after an executable stub.
 */
async function hasEncryptedZipLocalHeader(
  size: number,
  readRange: ArchiveRangeReader,
): Promise<boolean> {
  const length = Math.min(size, 1024 * 1024);
  const head = await readRange(0, length - 1);
  if (!head) return false;

  for (let offset = 0; offset + 30 <= head.length; offset++) {
    if (head.readUInt32LE(offset) !== ZIP_LOCAL_FILE_SIGNATURE) continue;
    const flags = head.readUInt16LE(offset + 6);
    if (
      flags &
      (ZIP_ENCRYPTED_FLAG | ZIP_STRONG_ENCRYPTION_FLAG | ZIP_MASKED_HEADER_FLAG)
    )
      return true;
    return false;
  }

  return false;
}

async function isEncrypted7z(
  size: number,
  readRange: ArchiveRangeReader,
): Promise<boolean> {
  const signature = await readRange(0, Math.min(size - 1, 31));
  if (!signature || signature.length < 32) return false;
  if (
    !signature.subarray(0, SEVEN_Z_SIGNATURE.length).equals(SEVEN_Z_SIGNATURE)
  )
    return false;

  const nextHeaderOffset = safeNumber(signature.readBigUInt64LE(12));
  const nextHeaderSize = safeNumber(signature.readBigUInt64LE(20));
  if (
    nextHeaderOffset === undefined ||
    nextHeaderSize === undefined ||
    nextHeaderSize <= 0
  )
    return false;

  const start = 32 + nextHeaderOffset;
  if (start >= size) return false;
  const length = Math.min(nextHeaderSize, MAX_7Z_HEADER_BYTES, size - start);
  if (length <= 4) return false;

  const header = await readRange(start, start + length - 1);
  if (!header) return false;

  // The 7zAES codec ID is 0x06F10701. Coder IDs are encoded as a flags byte
  // (low four bits contain the ID length) followed by the ID bytes, so look
  // for that exact structure instead of an arbitrary byte sequence.
  for (let offset = 0; offset + 5 <= header.length; offset++) {
    if ((header[offset] & 0x0f) !== 4) continue;
    if (
      header[offset + 1] === SEVEN_Z_AES_METHOD_ID[0] &&
      header[offset + 2] === SEVEN_Z_AES_METHOD_ID[1] &&
      header[offset + 3] === SEVEN_Z_AES_METHOD_ID[2] &&
      header[offset + 4] === SEVEN_Z_AES_METHOD_ID[3]
    )
      return true;
  }

  return false;
}

async function isEncryptedRar4(
  size: number,
  readRange: ArchiveRangeReader,
): Promise<boolean> {
  const window = new RangeWindow(readRange, size);
  let position = RAR4_SIGNATURE.length;

  for (let index = 0; index < MAX_RAR_HEADER_READS; index++) {
    if (position + 7 > size) return false;

    const block = await window.slice(
      position,
      Math.min(MAX_RAR_BLOCK_READ, size - position),
    );
    if (!block || block.length < 7) return false;

    const type = block[2];
    const flags = block.readUInt16LE(3);
    const headerSize = block.readUInt16LE(5);
    if (headerSize < 7) return false;

    if (type === RAR4_MAIN_HEADER && flags & RAR4_MAIN_ENCRYPTION_FLAGS)
      return true;
    if (type === RAR4_FILE_HEADER && flags & RAR4_FILE_ENCRYPTED_FLAG)
      return true;

    let dataSize = 0;
    if (type === RAR4_FILE_HEADER && block.length >= 11)
      dataSize = block.readUInt32LE(7);
    else if (flags & RAR4_HEAD_FLAG_LONG_BLOCK && block.length >= 11)
      dataSize = block.readUInt32LE(7);

    position += headerSize + dataSize;
  }

  return false;
}

async function isEncryptedRar5(
  size: number,
  readRange: ArchiveRangeReader,
): Promise<boolean> {
  const window = new RangeWindow(readRange, size);
  let position = RAR5_SIGNATURE.length;

  for (let index = 0; index < MAX_RAR_HEADER_READS; index++) {
    if (position + 7 > size) return false;

    let block = await window.slice(
      position,
      Math.min(MAX_RAR_BLOCK_READ, size - position),
    );
    if (!block || block.length < 5) return false;

    const headerSize = readVint(block, 4);
    if (!headerSize || headerSize.value < 1) return false;
    const headerEnd = 4 + headerSize.bytes + headerSize.value;
    if (headerEnd > MAX_RAR_HEADER_BYTES) return false;

    // The first read is intentionally small. Extend only when a header is
    // larger than the read window instead of allocating the maximum for every
    // block.
    if (headerEnd > block.length) {
      block = await window.slice(position, headerEnd);
      if (!block || block.length < headerEnd) return false;
    }

    const header = parseRar5Header(block, 4, headerSize.bytes, headerEnd);
    if (!header) return false;
    if (header.type === RAR5_ENCRYPTION_HEADER) return true;
    if (
      (header.type === RAR5_FILE_HEADER ||
        header.type === RAR5_SERVICE_HEADER) &&
      header.hasFileEncryption
    )
      return true;
    if (header.type === RAR5_END_HEADER) return false;

    position += headerEnd + header.dataSize;
  }

  return false;
}

type Rar5Header = {
  type: number;
  dataSize: number;
  hasFileEncryption: boolean;
};

function parseRar5Header(
  block: Buffer,
  sizeOffset: number,
  sizeBytes: number,
  headerEnd: number,
): Rar5Header | undefined {
  let offset = sizeOffset + sizeBytes;
  if (headerEnd > block.length) return undefined;
  const type = readVint(block, offset);
  if (!type) return undefined;
  offset += type.bytes;
  const flags = readVint(block, offset);
  if (!flags) return undefined;
  offset += flags.bytes;

  let extraSize = 0;
  if (flags.value & RAR5_HEADER_EXTRA_AREA) {
    const value = readVint(block, offset);
    if (!value) return undefined;
    extraSize = value.value;
    offset += value.bytes;
  }

  let dataSize = 0;
  if (flags.value & RAR5_HEADER_DATA_AREA) {
    const value = readVint(block, offset);
    if (!value) return undefined;
    dataSize = value.value;
    offset += value.bytes;
  }

  if (type.value !== RAR5_FILE_HEADER && type.value !== RAR5_SERVICE_HEADER)
    return { type: type.value, dataSize, hasFileEncryption: false };

  const fileFlags = readVint(block, offset);
  if (!fileFlags) return undefined;
  offset += fileFlags.bytes;
  const unpackedSize = readVint(block, offset);
  if (!unpackedSize) return undefined;
  offset += unpackedSize.bytes;
  const attributes = readVint(block, offset);
  if (!attributes) return undefined;
  offset += attributes.bytes;

  if (fileFlags.value & 0x0002) offset += 4; // mtime
  if (fileFlags.value & 0x0004) offset += 4; // data CRC32
  const compression = readVint(block, offset);
  if (!compression) return undefined;
  offset += compression.bytes;
  const hostOs = readVint(block, offset);
  if (!hostOs) return undefined;
  offset += hostOs.bytes;
  const nameLength = readVint(block, offset);
  if (!nameLength) return undefined;
  offset += nameLength.bytes + nameLength.value;

  if (offset > headerEnd) return undefined;
  if (extraSize > 0) {
    const extraEnd = offset + extraSize;
    if (extraEnd > headerEnd) return undefined;
    if (hasRar5FileEncryption(block, offset, extraEnd))
      return { type: type.value, dataSize, hasFileEncryption: true };
  }

  return { type: type.value, dataSize, hasFileEncryption: false };
}

function hasRar5FileEncryption(
  block: Buffer,
  start: number,
  end: number,
): boolean {
  let offset = start;
  while (offset < end) {
    const recordSize = readVint(block, offset);
    if (!recordSize) return false;
    offset += recordSize.bytes;
    const recordEnd = offset + recordSize.value;
    if (recordEnd > end) return false;
    const recordType = readVint(block, offset);
    if (!recordType) return false;
    if (recordType.value === RAR5_FILE_ENCRYPTION_RECORD) return true;
    offset = recordEnd;
  }
  return false;
}

type Vint = { value: number; bytes: number };

/**
 * Small sliding window over a range reader. RAR stores one header per block
 * with file data in between, so caching the last read avoids a storage request
 * for every small file while still jumping efficiently over large data areas.
 */
class RangeWindow {
  private buffer = Buffer.alloc(0);
  private start = 0;

  constructor(
    private readonly readRange: ArchiveRangeReader,
    private readonly size: number,
  ) {}

  async slice(offset: number, length: number): Promise<Buffer | undefined> {
    if (length <= 0 || offset < 0 || offset >= this.size) return undefined;
    const end = offset + length;
    if (offset >= this.start && end <= this.start + this.buffer.length)
      return this.buffer.subarray(offset - this.start, end - this.start);

    const windowEnd = Math.min(this.size - 1, end + MAX_RAR_BLOCK_READ - 1);
    const data = await this.readRange(offset, windowEnd);
    if (!data || data.length === 0) return undefined;

    this.buffer = data;
    this.start = offset;
    return data.subarray(0, Math.min(length, data.length));
  }
}

/**
 * RAR5/7z-style variable-length integer: seven data bits per byte, with the
 * high bit marking continuation. RAR also allows redundant 0x80 prefix bytes.
 */
function readVint(buffer: Buffer, offset: number): Vint | undefined {
  let value = 0;
  let bytes = 0;
  let shift = 0;

  while (offset + bytes < buffer.length && bytes < 10) {
    const byte = buffer[offset + bytes];
    bytes += 1;
    if (shift < 53) value += (byte & 0x7f) * 2 ** shift;
    shift += 7;
    if ((byte & 0x80) === 0) return { value, bytes };
  }

  return undefined;
}

function safeNumber(value: bigint): number | undefined {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return Number(value);
}
