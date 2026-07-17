import fs from "node:fs";
import path from "node:path";

export const MUSIC_EXTENSIONS = new Set([".mp3", ".m4a"]);
export const MUSIC_SCORE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif"]);

export function canManageMusicRole(account: { isAdmin: boolean; canPinMessages: boolean }) {
  return account.isAdmin || account.canPinMessages;
}

export function canManageMusicAsset(
  account: { accountId: number; isAdmin: boolean; canPinMessages: boolean },
  ownerAccountId: number | null | undefined
) {
  return canManageMusicRole(account) || (!!ownerAccountId && ownerAccountId === account.accountId);
}

export function isMusicFileName(name?: string | null) {
  return MUSIC_EXTENSIONS.has(path.extname(name || "").toLowerCase());
}

export function isMusicScoreImageName(name?: string | null) {
  return MUSIC_SCORE_EXTENSIONS.has(path.extname(name || "").toLowerCase());
}

export function isMusicFileHeader(bytes: Buffer, extension: string) {
  if (extension === ".mp3") {
    if (bytes.subarray(0, 3).toString("ascii") === "ID3") return true;
    return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  }
  if (extension === ".m4a") return bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp";
  return false;
}

export function isStoredMusicFile(filePath: string, extension: string) {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, "r");
    const header = Buffer.alloc(64);
    const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
    return isMusicFileHeader(header.subarray(0, bytesRead), extension);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

export function musicTrackTitle(fileName?: string | null) {
  const safeName = path.basename(String(fileName || "").trim());
  if (/^\.(mp3|m4a)$/i.test(safeName)) return "未命名歌曲";
  const extension = path.extname(safeName);
  return (extension ? safeName.slice(0, -extension.length) : safeName).trim() || "未命名歌曲";
}
