import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { MultipartFile } from "@fastify/multipart";
import sharp from "sharp";
import { isMusicScoreImageName, isMusicScorePdfName } from "./music.js";

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

async function savePartToFile(part: MultipartFile, targetPath: string) {
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createWriteStream(targetPath);
    part.file.pipe(stream);
    part.file.on("error", reject);
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
}

async function processPdfPart(
  part: MultipartFile,
  musicScoreDir: string
): Promise<{ page: ProcessedScorePage; temporaryPath: string; storedPath: string }> {
  const extension = path.extname(part.filename).toLowerCase();
  const temporaryName = `.${crypto.randomUUID()}${extension}.tmp`;
  const temporaryPath = path.join(musicScoreDir, temporaryName);
  await savePartToFile(part, temporaryPath);
  if (part.file.truncated) throw new Error("PDF 歌谱不能超过 20MB");

  const storedName = `${crypto.randomUUID()}${extension}`;
  const storedPath = path.join(musicScoreDir, storedName);
  fs.renameSync(temporaryPath, storedPath);
  const stat = fs.statSync(storedPath);
  return {
    page: {
      pageIndex: 0,
      fileName: path.basename(part.filename),
      filePath: storedName,
      fileSize: stat.size,
      width: 0,
      height: 0
    },
    temporaryPath,
    storedPath
  };
}

async function processImagePart(
  part: MultipartFile,
  pageIndex: number,
  deps: { musicScoreDir: string; imageWebpEffort: number; displayWebpFileName(name: string): string }
): Promise<{ page: ProcessedScorePage; temporaryPath: string; storedPath: string }> {
  const { musicScoreDir, imageWebpEffort, displayWebpFileName } = deps;
  const extension = path.extname(part.filename).toLowerCase();
  const temporaryName = `.${crypto.randomUUID()}${extension}.tmp`;
  const temporaryPath = path.join(musicScoreDir, temporaryName);
  await savePartToFile(part, temporaryPath);
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
  return {
    page: {
      pageIndex,
      fileName: displayWebpFileName(part.filename),
      filePath: storedName,
      fileSize: output.size,
      width: output.width,
      height: output.height
    },
    temporaryPath,
    storedPath
  };
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
  let mode: "image" | "pdf" | null = null;
  const discard = () => {
    for (const filePath of [...temporaryPaths, ...createdPaths]) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  };
  try {
    let pageIndex = 0;
    for await (const part of parts) {
      if (firstFileName === undefined) {
        firstFileName = part.filename;
        firstPartFields = multipartTextFields(part.fields);
        mode = isMusicScorePdfName(part.filename) ? "pdf" : "image";
      }
      if (mode === "pdf") {
        if (!isMusicScorePdfName(part.filename)) {
          part.file.resume();
          throw new Error("PDF 歌谱只能单独上传，不能与其他文件混合");
        }
        if (pageIndex > 0) {
          part.file.resume();
          throw new Error("PDF 歌谱只能上传一个文件");
        }
        const result = await processPdfPart(part, musicScoreDir);
        temporaryPaths.push(result.temporaryPath);
        createdPaths.push(result.storedPath);
        pages.push(result.page);
      } else {
        if (!isMusicScoreImageName(part.filename)) {
          part.file.resume();
          throw new Error("歌谱只支持 PNG、JPG、JPEG、WebP、HEIC、HEIF 图片或单个 PDF 文件");
        }
        const result = await processImagePart(part, pageIndex, { musicScoreDir, imageWebpEffort, displayWebpFileName });
        temporaryPaths.push(result.temporaryPath);
        createdPaths.push(result.storedPath);
        pages.push(result.page);
        fs.unlinkSync(result.temporaryPath);
        temporaryPaths.splice(temporaryPaths.indexOf(result.temporaryPath), 1);
      }
      pageIndex += 1;
    }
    if (!pages.length) throw new Error("请至少选择一页歌谱");
    return { pages, firstFileName, firstPartFields, discard };
  } catch (error) {
    discard();
    throw error;
  }
}
