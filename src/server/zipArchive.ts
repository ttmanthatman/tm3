import zlib from "node:zlib";

// 手写 ZIP 读写：服务器只依赖 Node 标准库，导出包为 store（不压缩）条目，
// 读取额外支持 deflate（方式 8）以兼容外部工具生成的包。

export type ZipArchiveEntry = { name: string; data: Buffer; date?: Date };

const ZIP_LOCAL_HEADER = 0x04034b50;
const ZIP_CENTRAL_HEADER = 0x02014b50;
const ZIP_END_HEADER = 0x06054b50;
// 防御 zip bomb：条目数量与解压后总量都设上限。
const UNZIP_MAX_ENTRIES = 20000;
const UNZIP_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

function crc32(buffer: Buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

function dosTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

export function zipArchive(entries: ZipArchiveEntry[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/^\/+/, ""), "utf8");
    const data = entry.data;
    const crc = crc32(data);
    const { time, day } = dosTime(entry.date);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(ZIP_LOCAL_HEADER, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(ZIP_CENTRAL_HEADER, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(ZIP_END_HEADER, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

function invalidZip(): Error & { statusCode?: number } {
  const error = new Error("导入文件不是有效的 ZIP 包") as Error & { statusCode?: number };
  error.statusCode = 400;
  return error;
}

export function unzipArchive(buffer: Buffer): ZipArchiveEntry[] {
  // 从尾部扫描 End of Central Directory 记录（允许最长 64KB 的注释）。
  const scanStart = Math.max(0, buffer.length - 22 - 65536);
  let endOffset = -1;
  for (let index = buffer.length - 22; index >= scanStart; index -= 1) {
    if (buffer.readUInt32LE(index) === ZIP_END_HEADER) {
      endOffset = index;
      break;
    }
  }
  if (endOffset < 0) throw invalidZip();
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  if (entryCount > UNZIP_MAX_ENTRIES) throw invalidZip();
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  if (centralOffset + centralSize > buffer.length) throw invalidZip();

  const entries: ZipArchiveEntry[] = [];
  let totalBytes = 0;
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== ZIP_CENTRAL_HEADER) throw invalidZip();
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    // 0xFFFFFFFF 表示 ZIP64，这里不支持。
    if ([compressedSize, uncompressedSize, localOffset].some((value) => value === 0xffffffff)) throw invalidZip();
    if (method !== 0 && method !== 8) throw invalidZip();
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");

    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== ZIP_LOCAL_HEADER) throw invalidZip();
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + compressedSize > buffer.length) throw invalidZip();
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed);
    if (data.length !== uncompressedSize) throw invalidZip();
    totalBytes += data.length;
    if (totalBytes > UNZIP_MAX_TOTAL_BYTES) throw invalidZip();
    if (name && !name.endsWith("/")) entries.push({ name, data });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function isZipArchive(buffer: Buffer) {
  return buffer.length >= 4 && buffer.readUInt32LE(0) === ZIP_LOCAL_HEADER;
}
