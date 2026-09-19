import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { STORY_LIMITS } from "../../shared/stories.js";
import { writeStoryImage, StoryImageBusyError } from "./storyImages.js";

const run = promisify(execFile);

export class StoryInputError extends Error {}

export interface StoredStoryMedia {
  position: number;
  kind: "image" | "voice";
  fileName: string;
  contentType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

export async function prepareStoryMedia(input: string, directory: string, kind: "image" | "voice", position: number, signal?: AbortSignal): Promise<StoredStoryMedia> {
  const fileName = `${crypto.randomUUID()}.${kind === "image" ? "webp" : "m4a"}`;
  const output = path.join(directory, fileName);
  if (kind === "image") {
    try {
      const info = await writeStoryImage(input, output, signal);
      await sharp(output).resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toFile(`${output}.thumb.webp`);
      return { position, kind, fileName, contentType: "image/webp", fileSize: (await fs.stat(output)).size, width: info.width, height: info.height, durationMs: null };
    } catch (error) {
      if (error instanceof StoryImageBusyError || signal?.aborted) throw error;
      throw new StoryInputError("图片内容无效或尺寸过大，请换一张图片");
    }
  }
  const handle = await fs.open(input, "r");
  const header = Buffer.alloc(16);
  try { await handle.read(header, 0, header.length, 0); } finally { await handle.close(); }
  const demuxer = header.subarray(4, 8).toString() === "ftyp" ? "mov"
    : header.subarray(0, 4).toString() === "OggS" ? "ogg"
    : header.subarray(0, 4).toString() === "RIFF" && header.subarray(8, 12).toString() === "WAVE" ? "wav"
    : header.readUInt32BE(0) === 0x1a45dfa3 ? "matroska"
    : header.subarray(0, 3).toString() === "ID3" || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0) ? "mp3" : null;
  if (!demuxer) throw new StoryInputError("语音文件内容无效");
  try {
    // Decode only local uploads. Limit both runtime and decoded duration; never
    // follow playlist URLs from untrusted audio files.
    await run("ffmpeg", ["-nostdin", "-y", "-protocol_whitelist", "file,pipe", "-f", demuxer, "-i", input,
      "-t", String(STORY_LIMITS.voiceSeconds + 1), "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000",
      "-map_metadata", "-1", "-c:a", "aac", "-b:a", "32k", "-movflags", "+faststart", output], { timeout: 30_000, maxBuffer: 512_000, signal, killSignal: "SIGKILL" });
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", output], { timeout: 10_000, signal, killSignal: "SIGKILL" });
    const durationMs = Math.round(Number(stdout.trim()) * 1000);
    if (!Number.isFinite(durationMs) || durationMs < 200 || durationMs > STORY_LIMITS.voiceSeconds * 1000 + 100) {
      throw new StoryInputError("语音需要在 0.2 秒至 3 分钟之间");
    }
    return { position, kind, fileName, contentType: "audio/mp4", fileSize: (await fs.stat(output)).size, width: null, height: null, durationMs };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof StoryInputError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("故事语音处理暂不可用，请联系管理员检查 FFmpeg");
    throw new StoryInputError("语音无法读取或处理超时，请重新录制");
  }
}

export function storyMediaPath(root: string, fileName: string) {
  // Stored names are generated internally and never supplied by the caller.
  if (!/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.(webp|m4a)$/.test(fileName)) throw new Error("Invalid story storage name");
  return path.join(root, fileName);
}
