import fs from "node:fs";
import path from "node:path";
import type { AdminAttachmentDTO } from "../shared/types.js";

export const ROOT = process.cwd();
export const DIST_CLIENT = path.join(ROOT, "dist/client");
export const STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(ROOT, "storage");
export const UPLOAD_DIR = path.join(STORAGE_ROOT, "uploads");
export const MUSIC_SCORE_DIR = path.join(STORAGE_ROOT, "music-scores");
export const BOOKS_DIR = path.join(STORAGE_ROOT, "books");
export const AVATAR_DIR = path.join(STORAGE_ROOT, "avatars");
export const BG_DIR = path.join(STORAGE_ROOT, "backgrounds");
export const PARALLAX_DIR = path.join(STORAGE_ROOT, "parallax");
export const BACKUP_DIR = path.join(STORAGE_ROOT, "backups");

export function storageFilePath(kind: AdminAttachmentDTO["kind"], fileName: string) {
  const dir = kind === "upload" ? UPLOAD_DIR : kind === "avatar" ? AVATAR_DIR : BG_DIR;
  return path.join(dir, path.basename(fileName));
}

export function safeUnlink(kind: AdminAttachmentDTO["kind"], fileName: string) {
  const target = storageFilePath(kind, fileName);
  if (fs.existsSync(target)) fs.unlinkSync(target);
}

export function safeUnlinkMusicScore(fileName: string) {
  const target = path.join(MUSIC_SCORE_DIR, path.basename(fileName));
  if (fs.existsSync(target)) fs.unlinkSync(target);
}
