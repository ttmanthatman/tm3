import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { READING_FONT_MAX_BYTES, type ReadingFontDTO } from "../../shared/readingFont.js";

// Validate container boundaries before storing untrusted font data. Browsers
// additionally validate/decode the font through FontFace before rendering it.
export function validateReadingFont(bytes: Buffer, name: string): ReadingFontDTO["format"] | null {
  if (bytes.length < 12 || bytes.length > READING_FONT_MAX_BYTES) return null;
  const format = path.extname(name).slice(1).toLowerCase();
  const signature = bytes.toString("ascii", 0, 4);
  if (format === "ttf" || format === "otf") {
    if (format === "otf" ? signature !== "OTTO" : bytes.readUInt32BE(0) !== 0x00010000 && signature !== "true") return null;
    const count = bytes.readUInt16BE(4);
    const directoryEnd = 12 + count * 16;
    if (!count || directoryEnd > bytes.length) return null;
    const tags = new Set<string>();
    for (let at = 12; at < directoryEnd; at += 16) {
      const tag = bytes.toString("ascii", at, at + 4);
      const offset = bytes.readUInt32BE(at + 8), length = bytes.readUInt32BE(at + 12);
      if (tags.has(tag) || offset < directoryEnd || offset + length > bytes.length) return null;
      tags.add(tag);
    }
    return ["cmap", "head", "maxp", "name"].every(tag => tags.has(tag)) ? format : null;
  }
  if (format !== "woff" && format !== "woff2") return null;
  const headerSize = format === "woff" ? 44 : 48;
  if (bytes.length < headerSize || signature !== (format === "woff" ? "wOFF" : "wOF2") || bytes.readUInt32BE(8) !== bytes.length || bytes.readUInt16BE(14) !== 0) return null;
  const count = bytes.readUInt16BE(12), expanded = bytes.readUInt32BE(16);
  if (!count || !expanded || expanded > 128 * 1024 * 1024) return null;
  if (format === "woff") {
    const directoryEnd = headerSize + count * 20;
    if (directoryEnd > bytes.length) return null;
    for (let at = headerSize; at < directoryEnd; at += 20) {
      const offset = bytes.readUInt32BE(at + 4), length = bytes.readUInt32BE(at + 8), original = bytes.readUInt32BE(at + 12);
      if (offset < directoryEnd || length > original || offset + length > bytes.length) return null;
    }
  } else if (bytes.readUInt32BE(20) > bytes.length - headerSize) return null;
  return format;
}

export function createReadingFontStorage(directory: string) {
  function filePath(font: ReadingFontDTO) { return path.join(directory, `${font.id}.${font.format}`); }
  return {
    filePath,
    async save(bytes: Buffer, name: string, format: ReadingFontDTO["format"]) {
      const font: ReadingFontDTO = { id: randomUUID(), name: name.replace(/\\/g, "/").split("/").pop()!.slice(0, 180), format };
      await fs.mkdir(directory, { recursive: true });
      try { await fs.writeFile(filePath(font), bytes, { flag: "wx" }); }
      catch (error) { await fs.rm(filePath(font), { force: true }); throw error; }
      return font;
    },
    async remove(font: ReadingFontDTO) { await fs.rm(filePath(font), { force: true }); }
  };
}
