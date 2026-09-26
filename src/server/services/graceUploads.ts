import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { GraceImage } from "../../shared/types.js";
import { GRACE_IMAGE_LIMIT } from "../../shared/grace.js";
import { STORY_LIMITS } from "../../shared/stories.js";
import { prepareStoryMedia, StoryInputError } from "./storyMedia.js";

// Draft files live only in scratch storage. Persist them after authorization and
// validation; failures remove both originals and converted images.
export async function readGraceUpload(request: FastifyRequest, reply: FastifyReply) {
  if (!request.isMultipart()) return { body: request.body || {}, images: [] as GraceImage[], read: async (_fileName: string): Promise<Buffer> => { throw new StoryInputError("请选择照片"); }, persist: async (_directory: string) => {}, dispose: async (_success = false) => {} };
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "grace-upload-"));
  const controller = new AbortController();
  const aborted = () => controller.abort();
  const closed = () => { if (!reply.raw.writableEnded) controller.abort(); };
  request.raw.once("aborted", aborted);
  reply.raw.once("close", closed);
  if (request.raw.aborted || (request.raw.destroyed && !request.raw.complete) || reply.raw.destroyed) controller.abort();
  const images: GraceImage[] = [];
  let body: unknown = {};
  let hasData = false;
  const persisted: string[] = [];
  async function dispose(success = false) {
    request.raw.removeListener("aborted", aborted);
    reply.raw.removeListener("close", closed);
    if (!success) for (const file of persisted) await fsp.rm(file, { force: true });
    await fsp.rm(scratch, { recursive: true, force: true });
  }
  try {
    for await (const part of request.parts({ limits: { files: GRACE_IMAGE_LIMIT, fields: 1, parts: GRACE_IMAGE_LIMIT + 1, fileSize: STORY_LIMITS.fileBytes, fieldSize: 100_000 } })) {
      controller.signal.throwIfAborted();
      if (part.type === "field") {
        if (hasData || part.fieldname !== "data" || part.valueTruncated || typeof part.value !== "string") throw new StoryInputError("恩典参数无效");
        try { body = JSON.parse(part.value); } catch { throw new StoryInputError("恩典参数无效"); }
        hasData = true;
      } else {
        if (part.fieldname !== "image") throw new StoryInputError("请选择照片");
        const input = path.join(scratch, `input-${images.length}`);
        await pipeline(part.file, fs.createWriteStream(input), { signal: controller.signal });
        if (part.file.truncated) throw new StoryInputError("每张照片不能超过 10 MB");
        const media = await prepareStoryMedia(input, scratch, "image", images.length, controller.signal);
        images.push({ fileName: media.fileName, width: media.width, height: media.height });
      }
    }
    if (!hasData) throw new StoryInputError("恩典参数无效");
    return { body, images, dispose, read: (fileName: string) => fsp.readFile(path.join(scratch, fileName)), persist: async (directory: string) => {
      controller.signal.throwIfAborted();
      await fsp.mkdir(directory, { recursive: true });
      for (const image of images) {
        const target = path.join(directory, image.fileName);
        await fsp.copyFile(path.join(scratch, image.fileName), target, fs.constants.COPYFILE_EXCL);
        persisted.push(target);
      }
    } };
  } catch (error) {
    await dispose();
    if (error instanceof StoryInputError) Object.assign(error, { statusCode: 400 });
    throw error;
  }
}
