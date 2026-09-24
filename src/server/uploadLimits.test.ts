import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { Readable } from "node:stream";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { multipartUploadOptions } from "./uploadLimits.js";

const boundary = "----tm3-unlimited-upload-boundary";
const chunkSize = 1024 * 1024;
const chunkCount = 81;

function largeMultipartPayload() {
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="large.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return Readable.from((function* () {
    yield head;
    for (let index = 0; index < chunkCount; index += 1) yield Buffer.alloc(chunkSize);
    yield tail;
  })());
}

test("chat multipart uploads have no application file-size cap", async () => {
  assert.equal(multipartUploadOptions.limits.fileSize, Number.POSITIVE_INFINITY);
  const app = Fastify();
  await app.register(multipart, multipartUploadOptions);
  app.post("/upload", async (request) => {
    const file = await request.file();
    assert.ok(file);
    let bytes = 0;
    for await (const chunk of file.file) bytes += Buffer.byteLength(chunk);
    return { bytes };
  });

  const response = await app.inject({
    method: "POST",
    url: "/upload",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: largeMultipartPayload()
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { bytes: chunkSize * chunkCount });
  await app.close();
});

test("the VPS Nginx template disables the request-body size cap", () => {
  const deployScript = fs.readFileSync(new URL("../../scripts/deploy-vps.sh", import.meta.url), "utf8");
  assert.match(deployScript, /client_max_body_size 0;/);
  assert.doesNotMatch(deployScript, /client_max_body_size 100m;/);
});
