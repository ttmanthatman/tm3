import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import sharp from "sharp";

const run = promisify(execFile);
const require = createRequire(import.meta.url);

// The portable HEVC decoder is deliberately isolated: decoding is synchronous
// and must not block the HTTP process. Paths are argv, never shell fragments.
const decoderScript = `
const fs = require('node:fs/promises');
const decode = require(${JSON.stringify(require.resolve("heic-decode"))});
const sharp = require(${JSON.stringify(require.resolve("sharp"))});
(async () => {
  const input = process.argv[1], output = process.argv[2];
  const metadata = await sharp(input, {limitInputPixels: 40000000}).metadata();
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > 40000000) throw new Error('Image too large');
  try {
    await sharp(input, {failOn: 'error', limitInputPixels: 40000000}).rotate()
      .resize({width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true}).webp({quality: 82}).toFile(output);
  } catch (error) {
    if (metadata.format !== 'heif') throw error;
    const image = await decode({buffer: await fs.readFile(input)});
    if (!image.width || !image.height || image.width * image.height > 40000000) throw new Error('Image too large');
    await sharp(Buffer.from(image.data), {raw: {width: image.width, height: image.height, channels: 4}})
      .resize({width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true}).webp({quality: 82}).toFile(output);
  }
})().catch(() => { process.exitCode = 1; });
`;

export class StoryImageBusyError extends Error {
  readonly statusCode = 503;
  constructor() { super("照片处理繁忙，请稍后重试"); }
}

export function createStoryImageProcessor(convert: (input: string, output: string, signal?: AbortSignal) => Promise<void>) {
  let active = false;
  const queue: Array<() => void> = [];
  function acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (!active) { active = true; return Promise.resolve(); }
    if (queue.length >= 3) return Promise.reject(new StoryImageBusyError());
    return new Promise((resolve, reject) => {
      const ready = () => { signal?.removeEventListener("abort", abort); resolve(); };
      const abort = () => { const index = queue.indexOf(ready); if (index >= 0) queue.splice(index, 1); signal?.removeEventListener("abort", abort); reject(signal?.reason); };
      queue.push(ready);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
  return async (input: string, output: string, signal?: AbortSignal) => {
    await acquire(signal);
    try {
      signal?.throwIfAborted();
      await convert(input, output, signal);
    } finally { const next = queue.shift(); if (next) next(); else active = false; }
  };
}

// One decoder at a time across both upload routes; only three may wait. The
// heap flag is NOT an RSS limit. Pixel/output caps, isolation, timeout and the
// global queue bound native/typed-array exposure as well as main-thread work.
const processImage = createStoryImageProcessor(async (input, output, signal) => {
  await run(process.execPath, ["--max-old-space-size=512", "--input-type=commonjs", "-e", decoderScript, input, output],
    { timeout: 30_000, maxBuffer: 256_000, killSignal: "SIGKILL", signal });
});

export async function writeStoryImage(input: string, output: string, signal?: AbortSignal) {
  await processImage(input, output, signal);
  if ((await fs.stat(output)).size > 8 * 1024 * 1024) throw new Error("Converted image too large");
  const metadata = await sharp(output).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Image has no dimensions");
  return { width: metadata.width, height: metadata.height };
}
