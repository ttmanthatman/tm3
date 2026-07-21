import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { MultipartFile } from "@fastify/multipart";
import sharp from "sharp";
import { isMusicScoreImageName } from "./music.js";

export type ProcessedScorePage = {
  pageIndex: number;
  fileName: string;
  filePath: string;
  fileSize: number;
  width: number;
  height: number;
};

export type ProcessedScoreImages = {
  pages: ProcessedScorePage[];
  firstFileName?: string;
  firstPartFields: Record<string, string>;
  discard(): void;
};

export function multipartTextFields(fields: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!fields || typeof fields !== "object") return result;
  for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
    if (value && typeof value === "object" && "value" in value && typeof (value as { value: unknown }).value === "string") {
      result[key] = (value as { value: string }).value;
    }
  }
  return result;
}

export async function processScoreImageParts(
  parts: AsyncIterableIterator<MultipartFile>,
  deps: {
    musicScoreDir: string;
    imageWebpEffort: number;
    displayWebpFileName(name: string): string;
  }
): Promise<ProcessedScoreImages> {
  const { musicScoreDir, imageWebpEffort, displayWebpFileName } = deps;
  const temporaryPaths: string[] = [];
  const createdPaths: string[] = [];
  const pages: ProcessedScorePage[] = [];
  let firstFileName: string | undefined;
  let firstPartFields: Record<string, string> = {};
  const discard = () => {
    for (const filePath of [...temporaryPaths, ...createdPaths]) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  };
  try {
    let pageIndex = 0;
    for await (const part of parts) {
      if (!isMusicScoreImageName(part.filename)) {
        part.file.resume();
        throw new Error("歌谱只支持 PNG、JPG、JPEG、WebP、HEIC 和 HEIF 图片");
      }
      if (firstFileName === undefined) {
        firstFileName = part.filename;
        firstPartFields = multipartTextFields(part.fields);
      }
      const extension = path.extname(part.filename).toLowerCase();
      const temporaryName = `.${crypto.randomUUID()}${extension}.tmp`;
      const temporaryPath = path.join(musicScoreDir, temporaryName);
      temporaryPaths.push(temporaryPath);
      await new Promise<void>((resolve, reject) => {
        const stream = fs.createWriteStream(temporaryPath);
        part.file.pipe(stream);
        part.file.on("error", reject);
        stream.on("finish", resolve);
        stream.on("error", reject);
      });
      if (part.file.truncated) throw new Error("单页歌谱不能超过 20MB");

      const storedName = `${crypto.randomUUID()}.webp`;
      const storedPath = path.join(musicScoreDir, storedName);
      const output = await sharp(temporaryPath, { failOn: "error", limitInputPixels: 40_000_000 })
        .rotate()
        .webp({ quality: 92, effort: imageWebpEffort, smartSubsample: true })
        .toFile(storedPath);
      if (!output.width || !output.height || output.width > 20_000 || output.height > 20_000) {
        if (fs.existsSync(storedPath)) fs.unlinkSync(storedPath);
        throw new Error("歌谱图片内容无效或尺寸过大");
      }
      createdPaths.push(storedPath);
      pages.push({
        pageIndex,
        fileName: displayWebpFileName(part.filename),
        filePath: storedName,
        fileSize: output.size,
        width: output.width,
        height: output.height
      });
      pageIndex += 1;
      fs.unlinkSync(temporaryPath);
      temporaryPaths.splice(temporaryPaths.indexOf(temporaryPath), 1);
    }
    if (!pages.length) throw new Error("请至少选择一页歌谱");
    return { pages, firstFileName, firstPartFields, discard };
  } catch (error) {
    discard();
    throw error;
  }
}
