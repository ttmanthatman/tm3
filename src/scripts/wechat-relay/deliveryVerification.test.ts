import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { deliveryImageChange } from "./deliveryVerification.js";

test("a short outgoing bubble is visible even when whole-chat average is below 0.01", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "relay-short-bubble-"));
  try {
    const before = path.join(directory, "before.png");
    const after = path.join(directory, "after.png");
    const background = { create: { width: 650, height: 470, channels: 3 as const, background: "#ededed" } };
    await sharp(background).png().toFile(before);
    const bubble = await sharp({ create: { width: 126, height: 36, channels: 3, background: "#95ec69" } }).png().toBuffer();
    await sharp(background).composite([{ input: bubble, left: 500, top: 415 }]).png().toFile(after);
    const change = await deliveryImageChange(before, after);
    assert.ok(change.average < 0.01, `whole-chat average ${change.average} must reproduce the failure`);
    assert.ok(change.local >= 0.01, "a short visible bubble must not stop the relay");
    assert.ok(change.changedPixels > 100);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("unchanged images have no delivery signal and dimensions must match", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "relay-image-safety-"));
  try {
    const before = path.join(directory, "before.png");
    const other = path.join(directory, "other.png");
    await sharp({ create: { width: 650, height: 470, channels: 3, background: "#ededed" } }).png().toFile(before);
    assert.deepEqual(await deliveryImageChange(before, before), { average: 0, local: 0, changedPixels: 0 });
    await sharp({ create: { width: 649, height: 470, channels: 3, background: "#ededed" } }).png().toFile(other);
    await assert.rejects(deliveryImageChange(before, other), /Unable to compare/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
