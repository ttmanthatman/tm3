import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import sharp from "sharp";

const run = promisify(execFile);
const require = createRequire(import.meta.url);

// The portable HEVC decoder is deliberately isolated: decoding is synchronous
// and must not block the HTTP process. Paths are argv, never shell fragments.
// maxEdge 0 keeps the original resolution (chat HEIC uploads); stories pass 2400.
const decoderScript = `
const fs = require('node:fs/promises');
const decode = require(${JSON.stringify(require.resolve("heic-decode"))});
const sharp = require(${JSON.stringify(require.resolve("sharp"))});
(async () => {
  const input = process.argv[1], output = process.argv[2];
  const maxEdge = Number(process.argv[3]) || 0;
  const quality = Number(process.argv[4]) || 82;
  const write = (pipeline) => {
    const sized = maxEdge ? pipeline.resize({width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true}) : pipeline;
    return sized.webp({quality}).toFile(output);
  };
  const metadata = await sharp(input, {limitInputPixels: 40000000}).metadata();
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > 40000000) throw new Error('Image too large');
  try {
    await write(sharp(input, {failOn: 'error', limitInputPixels: 40000000}).rotate());
  } catch (error) {
    if (metadata.format !== 'heif') throw error;
    const image = await decode({buffer: await fs.readFile(input)});
    if (!image.width || !image.height || image.width * image.height > 40000000) throw new Error('Image too large');
    await write(sharp(Buffer.from(image.data), {raw: {width: image.width, height: image.height, channels: 4}}));
  }
})().catch(() => { process.exitCode = 1; });
`;

export class StoryImageBusyError extends Error {
  readonly statusCode = 503;
  constructor() { super("照片处理繁忙，请稍后重试"); }
}

export type DecoderImageOptions = { maxEdge?: number; quality?: number };

export function createStoryImageProcessor(convert: (input: string, output: string, signal: AbortSignal | undefined, options: DecoderImageOptions) => Promise<void>) {
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
  return async (input: string, output: string, signal?: AbortSignal, options: DecoderImageOptions = {}) => {
    await acquire(signal);
    try {
      signal?.throwIfAborted();
      await convert(input, output, signal, options);
    } finally { const next = queue.shift(); if (next) next(); else active = false; }
  };
}

// One decoder at a time across all upload routes; only three may wait. The
// heap flag is NOT an RSS limit. Pixel/output caps, isolation, timeout and the
// global queue bound native/typed-array exposure as well as main-thread work.
const processImage = createStoryImageProcessor(async (input, output, signal, options) => {
  await run(process.execPath, ["--max-old-space-size=512", "--input-type=commonjs", "-e", decoderScript, input, output, String(options.maxEdge ?? 0), String(options.quality ?? 82)],
    { timeout: 30_000, maxBuffer: 256_000, killSignal: "SIGKILL", signal });
});

export async function writeStoryImage(input: string, output: string, signal?: AbortSignal) {
  await processImage(input, output, signal, { maxEdge: 2400, quality: 82 });
  if ((await fs.stat(output)).size > 8 * 1024 * 1024) throw new Error("Converted image too large");
  const metadata = await sharp(output).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Image has no dimensions");
  return { width: metadata.width, height: metadata.height };
}

// Same isolated decoder without the story-specific 2400px cap; chat HEIC
// uploads keep their original resolution.
export async function convertImageWithDecoder(input: string, output: string, options: DecoderImageOptions = {}, signal?: AbortSignal) {
  await processImage(input, output, signal, options);
}
