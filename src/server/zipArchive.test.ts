import assert from "node:assert/strict";
import zlib from "node:zlib";
import test from "node:test";
import { isZipArchive, unzipArchive, zipArchive } from "./zipArchive.js";

test("zipArchive/unzipArchive round-trips entries including unicode names", () => {
  const entries = [
    { name: "chat.json", data: Buffer.from(JSON.stringify({ version: 1, messages: [] }), "utf8") },
    { name: "uploads/图片-1.png", data: Buffer.from([1, 2, 3, 4, 5]) },
    { name: "avatars/abc.webp", data: Buffer.alloc(1024, 7) }
  ];
  const archive = zipArchive(entries);
  assert.equal(isZipArchive(archive), true);
  const restored = unzipArchive(archive);
  assert.deepEqual(
    restored.map((entry) => entry.name),
    entries.map((entry) => entry.name)
  );
  for (const [index, entry] of entries.entries()) {
    assert.deepEqual(restored[index].data, entry.data);
  }
});

test("unzipArchive reads deflated entries produced by external tools", () => {
  const name = Buffer.from("users.json", "utf8");
  const data = Buffer.from(JSON.stringify({ hello: "世界" }), "utf8");
  const compressed = zlib.deflateRawSync(data);
  const crc = (() => {
    let value = -1;
    for (const byte of data) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
    }
    return (value ^ -1) >>> 0;
  })();
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  const centralOffset = local.length + name.length + compressed.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  const archive = Buffer.concat([local, name, compressed, central, name, end]);

  const restored = unzipArchive(archive);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].name, "users.json");
  assert.deepEqual(restored[0].data, data);
});

test("unzipArchive rejects non-zip and truncated archives", () => {
  assert.equal(isZipArchive(Buffer.from('{"a":1}', "utf8")), false);
  assert.throws(() => unzipArchive(Buffer.from('{"a":1}', "utf8")), /ZIP/);
  const truncated = zipArchive([{ name: "chat.json", data: Buffer.from("{}") }]).subarray(0, 40);
  assert.throws(() => unzipArchive(Buffer.from(truncated)), /ZIP/);
});
