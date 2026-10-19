import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { loadRelayConfig } from "./config.js";
import { AmbiguousDeliveryError, SafeRelayError } from "./errors.js";
import type { QueueItem } from "./queue.js";
import { X11WeChatDriver } from "./x11Driver.js";

async function desktop(options: { pasteMissing?: boolean; composerStuck?: boolean; chatUnchanged?: boolean; delayed?: boolean; wrongTarget?: boolean; captureFails?: boolean } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "relay-desktop-"));
  const config = loadRelayConfig({ RELAY_BASE_URL: "https://example.com", RELAY_AGENT_TOKEN: "test" }).x11;
  config.anchorPath = path.join(directory, "anchor.png");
  config.anchorRegion = { x: 0, y: 0, width: 20, height: 20 };
  config.composerRegion = { x: 300, y: 600, width: 650, height: 66 };
  const blank = await sharp({ create: { width: 650, height: 470, channels: 3, background: "#ededed" } }).png().toBuffer();
  const bubble = await sharp({ create: { width: 126, height: 36, channels: 3, background: "#95ec69" } }).png().toBuffer();
  const changed = await sharp(blank).composite([{ input: bubble, left: 500, top: 415 }]).png().toBuffer();
  const empty = await sharp({ create: { width: 650, height: 66, channels: 3, background: "#ededed" } }).png().toBuffer();
  const text = await sharp({ create: { width: 90, height: 12, channels: 3, background: "#111111" } }).png().toBuffer();
  const staged = await sharp(empty).composite([{ input: text, left: 10, top: 10 }]).png().toBuffer();
  const anchor = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#ededed" } }).png().toBuffer();
  await fs.promises.writeFile(config.anchorPath, anchor);
  let enterCount = 0;
  let afterCount = 0;
  const item: QueueItem = {
    sourceId: 5346, channelId: 7, formattedText: "发送者说话了", state: "processing", attemptCount: 1,
    nextAttemptAt: 0, lastError: null, sourceCreatedAt: Date.now(),
    message: { id: 5346, channelId: 7, content: "message", type: "text", createdAt: new Date().toISOString(),
      sender: { id: 3, kind: "human", username: "sender", displayName: "发送者" } }
  };
  const driver = new X11WeChatDriver(config, {
    wait: async () => undefined,
    paste: async (_content, _environment, request) => { await request(); },
    execute: async (command, args) => {
      if (command === "scrot") {
        const destination = args.at(-1)!;
        let content = anchor;
        if (destination.includes("composer-empty")) content = empty;
        else if (destination.includes("composer-staged")) content = options.pasteMissing ? empty : staged;
        else if (destination.includes("composer-after")) content = options.composerStuck || (options.delayed && afterCount < 2) ? staged : empty;
        else if (destination.includes("-before-")) content = blank;
        else if (destination.includes("-after-")) {
          if (options.captureFails) throw new Error("Screenshot failed after Enter");
          afterCount += 1;
          content = options.chatUnchanged || (options.delayed && afterCount < 2) ? blank : changed;
        } else if (options.wrongTarget) content = await sharp(anchor).negate().png().toBuffer();
        await fs.promises.writeFile(destination, content);
      }
      if (args[0] === "search") return "1";
      if (args[0] === "getwindowname") return "微信";
      if (args[0] === "getwindowgeometry") return "X=0\nY=0\nWIDTH=1280\nHEIGHT=720";
      if (args[0] === "key" && args.at(-1) === "Return") enterCount += 1;
      return "";
    }
  });
  return { driver, item, directory, config, enterCount: () => enterCount, afterCount: () => afterCount };
}

test("the real driver confirms a small bubble with an empty composer", async () => {
  const fixture = await desktop();
  try {
    const result = await fixture.driver.send(fixture.item);
    assert.match(result.summary, /composer cleared/);
    assert.equal(fixture.enterCount(), 1);
    assert.ok(!fs.existsSync(`${fixture.config.anchorPath}.evidence`));
  } finally { fs.rmSync(fixture.directory, { recursive: true, force: true }); }
});

test("a delayed render is checked again without pressing Enter again", async () => {
  const fixture = await desktop({ delayed: true });
  try {
    await fixture.driver.send(fixture.item);
    assert.equal(fixture.afterCount(), 2);
    assert.equal(fixture.enterCount(), 1);
  } finally { fs.rmSync(fixture.directory, { recursive: true, force: true }); }
});

for (const scenario of [{ composerStuck: true }, { chatUnchanged: true }]) {
  test(`uncertain delivery retains evidence and does not resend: ${JSON.stringify(scenario)}`, async () => {
    const fixture = await desktop(scenario);
    try {
      await assert.rejects(fixture.driver.send(fixture.item), AmbiguousDeliveryError);
      assert.equal(fixture.enterCount(), 1);
      const root = `${fixture.config.anchorPath}.evidence`;
      const evidence = path.join(root, fs.readdirSync(root)[0]);
      assert.deepEqual(fs.readdirSync(evidence).sort(), ["after.png", "before.png", "cleared.png", "delivery.json", "empty.png", "staged.png"]);
      assert.equal(fs.statSync(evidence).mode & 0o777, 0o700);
      assert.equal(fs.statSync(path.join(evidence, "staged.png")).mode & 0o777, 0o600);
      assert.equal(JSON.parse(fs.readFileSync(path.join(evidence, "delivery.json"), "utf8")).sourceId, 5346);
    } finally { fs.rmSync(fixture.directory, { recursive: true, force: true }); }
  });
}

for (const scenario of [{ pasteMissing: true }, { wrongTarget: true }]) {
  test(`unsafe desktop state never reaches Enter: ${JSON.stringify(scenario)}`, async () => {
    const fixture = await desktop(scenario);
    try {
      await assert.rejects(fixture.driver.send(fixture.item), SafeRelayError);
      assert.equal(fixture.enterCount(), 0);
    } finally { fs.rmSync(fixture.directory, { recursive: true, force: true }); }
  });
}

test("a capture failure after Enter stays uncertain and preserves available evidence", async () => {
  const fixture = await desktop({ captureFails: true });
  try {
    await assert.rejects(fixture.driver.send(fixture.item), AmbiguousDeliveryError);
    assert.equal(fixture.enterCount(), 1);
    const root = `${fixture.config.anchorPath}.evidence`;
    const evidence = path.join(root, fs.readdirSync(root)[0]);
    assert.ok(fs.existsSync(path.join(evidence, "before.png")));
    assert.ok(fs.existsSync(path.join(evidence, "staged.png")));
  } finally { fs.rmSync(fixture.directory, { recursive: true, force: true }); }
});
