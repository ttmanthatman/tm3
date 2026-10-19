import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { Rectangle, X11DriverConfig } from "./config.js";
import { RelayDriverOperations, type DeliveryEvidence, type WeChatDriver } from "./driver.js";
import { AmbiguousDeliveryError, SafeRelayError } from "./errors.js";
import type { QueueItem } from "./queue.js";
import { composerWasCleared, deliveryImageChange } from "./deliveryVerification.js";

interface WindowGeometry {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WindowCandidate {
  id: string;
  title: string;
  geometry: WindowGeometry;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

interface ClipboardTransferOptions {
  spawnClipboard?: typeof spawn;
  readyWaitMs?: number;
  requestTimeoutMs?: number;
}

export async function pasteClipboardText(
  content: string,
  environment: NodeJS.ProcessEnv,
  requestPaste: () => Promise<unknown>,
  options: ClipboardTransferOptions = {}
) {
  const spawnClipboard = options.spawnClipboard || spawn;
  const readyWaitMs = options.readyWaitMs ?? 100;
  const requestTimeoutMs = options.requestTimeoutMs ?? 5000;
  const child = spawnClipboard(
    "xclip",
    ["-selection", "clipboard", "-loops", "1", "-silent"],
    { env: environment, stdio: ["pipe", "ignore", "pipe"] }
  );
  const errors: Buffer[] = [];
  let closed = false;
  let timeout: NodeJS.Timeout | undefined;
  child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
  child.stderr.on("error", () => undefined);
  child.stdin.on("error", () => undefined);
  const spawned = new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  const completed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("close", (code, signal) => {
      closed = true;
      resolve({ code, signal });
    });
  });
  try {
    await spawned;
    child.on("error", () => undefined);
    child.stdin.end(content, "utf8");
    await delay(readyWaitMs);
    await requestPaste();
    const outcome = await Promise.race([
      completed,
      new Promise<"timeout">((resolve) => {
        timeout = setTimeout(() => resolve("timeout"), requestTimeoutMs);
      })
    ]);
    if (outcome === "timeout") {
      throw new SafeRelayError("WeChat did not request the clipboard contents; the message was not sent");
    }
    if (outcome.code !== 0) {
      const detail = errors.length
        ? Buffer.concat(errors).toString("utf8").trim()
        : outcome.signal
          ? `signal ${outcome.signal}`
          : `exit ${outcome.code}`;
      throw new SafeRelayError(`xclip failed while handing text to WeChat: ${detail}`);
    }
  } finally {
    if (timeout) clearTimeout(timeout);
    if (!closed) child.kill("SIGTERM");
  }
}

export function parseWindowGeometry(output: string, id: string): WindowGeometry {
  const values = Object.fromEntries(
    output.split(/\r?\n/)
      .map((line) => line.match(/^([A-Z]+)=(-?\d+)$/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => [match[1], Number(match[2])])
  );
  const geometry = {
    id,
    x: values.X,
    y: values.Y,
    width: values.WIDTH,
    height: values.HEIGHT
  };
  if (Object.values(geometry).some((value) => value === undefined || (typeof value === "number" && !Number.isFinite(value)))) {
    throw new SafeRelayError("Unable to read the WeChat window geometry");
  }
  return geometry;
}

export async function selectUsableWindow(
  ids: readonly string[],
  expectedTitle: string,
  inspect: (id: string) => Promise<WindowCandidate>,
  activate: (candidate: WindowCandidate) => Promise<WindowGeometry>
) {
  const candidates: WindowCandidate[] = [];
  let lastError: unknown;
  for (const id of ids) {
    try {
      const candidate = await inspect(id);
      if (candidate.title.includes(expectedTitle)) candidates.push(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  candidates.sort((left, right) => (
    right.geometry.width * right.geometry.height - left.geometry.width * left.geometry.height
  ));
  for (const candidate of candidates) {
    try {
      return await activate(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return null;
}

async function imageDifference(leftPath: string, rightPath: string) {
  const left = await sharp(leftPath).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  const right = await sharp(rightPath).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  if (
    left.info.width !== right.info.width
    || left.info.height !== right.info.height
    || left.data.length !== right.data.length
    || left.data.length === 0
  ) {
    throw new SafeRelayError("Unable to compare WeChat verification images");
  }
  let difference = 0;
  for (let index = 0; index < left.data.length; index += 1) {
    difference += Math.abs(left.data[index] - right.data[index]);
  }
  return difference / left.data.length / 255;
}

interface X11DriverRuntime {
  execute?: (command: string, args: string[]) => Promise<string>;
  paste?: typeof pasteClipboardText;
  wait?: (milliseconds: number) => Promise<void>;
}

export class X11WeChatDriver implements WeChatDriver {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly operations = new RelayDriverOperations();
  private stopping = false;

  constructor(private readonly config: X11DriverConfig, private readonly runtime: X11DriverRuntime = {}) {
    this.environment = { ...process.env, DISPLAY: config.display };
  }

  stop() {
    this.stopping = true;
  }

  private execute(command: string, args: string[]) {
    if (this.runtime.execute) return this.runtime.execute(command, args);
    return new Promise<string>((resolve, reject) => {
      execFile(command, args, { env: this.environment, timeout: 15000, encoding: "utf8" }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${command} failed: ${(stderr || error.message).trim()}`));
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  private async findWindow() {
    let output = "";
    try {
      output = await this.execute("xdotool", ["search", "--onlyvisible", "--class", this.config.windowClass]);
    } catch (error) {
      throw new SafeRelayError("The official WeChat window is not visible; login may be required", { cause: error });
    }
    const ids = output.split(/\s+/).filter((id) => /^\d+$/.test(id));
    if (!ids.length) throw new SafeRelayError("The official WeChat window is not visible; login may be required");
    try {
      const window = await selectUsableWindow(
        ids,
        this.config.windowTitle,
        async (id) => {
          const title = await this.execute("xdotool", ["getwindowname", id]);
          const geometry = parseWindowGeometry(
            await this.execute("xdotool", ["getwindowgeometry", "--shell", id]),
            id
          );
          return { id, title, geometry };
        },
        async ({ id }) => {
          await this.execute("xdotool", ["windowsize", "--sync", id, String(this.config.windowWidth), String(this.config.windowHeight)]);
          await this.execute("xdotool", ["windowactivate", "--sync", id]);
          return parseWindowGeometry(
            await this.execute("xdotool", ["getwindowgeometry", "--shell", id]),
            id
          );
        }
      );
      if (window) return window;
    } catch (error) {
      throw new SafeRelayError("The official WeChat window changed while it was being selected; retry the message", { cause: error });
    }
    throw new SafeRelayError("The official WeChat window is not visible; login may be required");
  }

  private absoluteRegion(window: WindowGeometry, region: Rectangle): Rectangle {
    if (region.width <= 0 || region.height <= 0 || region.x + region.width > window.width || region.y + region.height > window.height) {
      throw new SafeRelayError("Configured verification region falls outside the WeChat window");
    }
    return { ...region, x: window.x + region.x, y: window.y + region.y };
  }

  private async screenshot(region: Rectangle, destination: string) {
    await this.execute("scrot", ["--silent", "-a", `${region.x},${region.y},${region.width},${region.height}`, destination]);
  }

  private temporaryImage(label: string) {
    return path.join(os.tmpdir(), `wechat-relay-${label}-${crypto.randomUUID()}.png`);
  }

  private async verifyTarget(window: WindowGeometry) {
    if (!fs.existsSync(this.config.anchorPath)) {
      throw new SafeRelayError("Target-group anchor is missing; run the calibrate command first");
    }
    const current = this.temporaryImage("anchor");
    try {
      await this.screenshot(this.absoluteRegion(window, this.config.anchorRegion), current);
      const difference = await imageDifference(this.config.anchorPath, current);
      if (difference > this.config.anchorMaxDifference) {
        throw new SafeRelayError(
          `The visible chat does not match the calibrated target group (difference ${difference.toFixed(4)})`
        );
      }
      return difference;
    } finally {
      fs.rmSync(current, { force: true });
    }
  }

  private async clearComposer(windowId: string) {
    await this.execute("xdotool", ["key", "--window", windowId, "ctrl+a", "BackSpace"]);
  }

  private async insertMention(window: WindowGeometry, name: string) {
    const region = this.absoluteRegion(window, this.config.mentionRegion);
    const before = this.temporaryImage("mention-before");
    const popup = this.temporaryImage("mention-popup");
    const settled = this.temporaryImage("mention-settled");
    try {
      await this.screenshot(region, before);
      await this.execute("xdotool", ["type", "--window", window.id, "--clearmodifiers", "--delay", "30", "@"]);
      await pasteClipboardText(name, this.environment, () => (
        this.execute("xdotool", ["key", "--window", window.id, "ctrl+v"])
      ));
      await delay(this.config.mentionWaitMs);
      await this.screenshot(region, popup);
      const appeared = await imageDifference(before, popup);
      if (appeared < this.config.mentionMinDifference) {
        throw new SafeRelayError(`WeChat did not show a member candidate for ${name}; check the one-to-one mapping`);
      }
      await this.execute("xdotool", ["key", "--window", window.id, "Return"]);
      await delay(300);
      await this.screenshot(region, settled);
      const dismissed = await imageDifference(popup, settled);
      if (dismissed < this.config.mentionMinDifference) {
        throw new SafeRelayError(`WeChat did not accept the member candidate for ${name}; check the one-to-one mapping`);
      }
    } finally {
      fs.rmSync(before, { force: true });
      fs.rmSync(popup, { force: true });
      fs.rmSync(settled, { force: true });
    }
  }

  async doctor() {
    return this.operations.run(() => this.checkDesktop());
  }

  private async checkDesktop() {
    const findings: string[] = [];
    for (const command of ["xdotool", "xclip", "scrot"]) {
      try {
        await this.execute("which", [command]);
        findings.push(`${command} is available`);
      } catch (error) {
        throw new SafeRelayError(`Required X11 command is missing: ${command}`, { cause: error });
      }
    }
    if (!fs.existsSync(this.config.anchorPath)) {
      throw new SafeRelayError("Target-group anchor is missing; open the target group and run calibrate");
    }
    const window = await this.findWindow();
    const difference = await this.verifyTarget(window);
    findings.push(`target-group anchor verified (difference ${difference.toFixed(4)})`);
    return findings;
  }

  async calibrate() {
    return this.operations.run(() => this.captureAnchor());
  }

  private async captureAnchor() {
    const window = await this.findWindow();
    fs.mkdirSync(path.dirname(this.config.anchorPath), { recursive: true });
    await this.screenshot(this.absoluteRegion(window, this.config.anchorRegion), this.config.anchorPath);
    return this.config.anchorPath;
  }

  async send(item: QueueItem): Promise<DeliveryEvidence> {
    return this.operations.run(() => this.sendToDesktop(item));
  }

  private async sendToDesktop(item: QueueItem): Promise<DeliveryEvidence> {
    if (this.stopping) throw new SafeRelayError("Relay stopped before desktop delivery began");
    const window = await this.findWindow();
    if (this.config.inputPoint.x >= window.width || this.config.inputPoint.y >= window.height) {
      throw new SafeRelayError("Configured input point falls outside the WeChat window");
    }
    const anchorDifference = await this.verifyTarget(window);
    const messageRegion = this.absoluteRegion(window, this.config.messageRegion);
    const composerRegion = this.absoluteRegion(window, this.config.composerRegion);
    const before = this.temporaryImage("before");
    const after = this.temporaryImage("after");
    const empty = this.temporaryImage("composer-empty");
    const staged = this.temporaryImage("composer-staged");
    const cleared = this.temporaryImage("composer-after");
    const wait = this.runtime.wait ?? delay;
    const paste = this.runtime.paste ?? pasteClipboardText;
    let sendKeyPressed = false;
    try {
      await this.execute("xdotool", [
        "mousemove", "--window", window.id,
        String(this.config.inputPoint.x), String(this.config.inputPoint.y),
        "click", "1"
      ]);
      await this.clearComposer(window.id);
      await wait(this.config.pasteWaitMs);
      await this.screenshot(composerRegion, empty);
      const mentions = [...new Set(item.message.relayMentions || [])].slice(0, 20);
      if (mentions.length) {
        try {
          for (const mention of mentions) await this.insertMention(window, mention);
        } catch (error) {
          await this.clearComposer(window.id).catch(() => undefined);
          throw error;
        }
      }
      await paste(item.formattedText, this.environment, () => (
        this.execute("xdotool", ["key", "--window", window.id, "ctrl+v"])
      ));
      await wait(this.config.pasteWaitMs);
      await this.screenshot(composerRegion, staged);
      const inserted = await deliveryImageChange(empty, staged);
      if (inserted.changedPixels < 64) {
        throw new SafeRelayError("Pasted text was not visible in the WeChat composer; the message was not sent");
      }
      // Capture just before Enter so focus, selection and mention-popup changes
      // cannot be mistaken for a newly sent notification.
      await this.screenshot(messageRegion, before);
      sendKeyPressed = true;
      await this.execute("xdotool", ["key", "--window", window.id, "Return"]);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await wait(attempt === 0 ? this.config.postSendWaitMs : 1000);
        await this.screenshot(messageRegion, after);
        await this.screenshot(composerRegion, cleared);
        const change = await deliveryImageChange(before, after);
        if (change.local >= this.config.messageMinDifference && change.changedPixels >= 64
          && await composerWasCleared(empty, staged, cleared)) {
          return {
            summary: `target difference ${anchorDifference.toFixed(4)}, chat change ${change.average.toFixed(4)}, local change ${change.local.toFixed(4)}, composer cleared`
          };
        }
      }
      throw new AmbiguousDeliveryError("The send key was pressed but a changed chat and cleared composer could not both be verified");
    } catch (error) {
      if (sendKeyPressed) {
        const directory = path.join(`${this.config.anchorPath}.evidence`, `${item.sourceId}-${Date.now()}`);
        try {
          fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
          for (const [name, source] of Object.entries({ before, after, empty, staged, cleared })) {
            if (fs.existsSync(source)) {
              const destination = path.join(directory, `${name}.png`);
              fs.copyFileSync(source, destination);
              fs.chmodSync(destination, 0o600);
            }
          }
          fs.writeFileSync(path.join(directory, "delivery.json"), JSON.stringify({
            sourceId: item.sourceId, capturedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : String(error)
          }), { mode: 0o600 });
        } catch (evidenceError) {
          console.error("WeChat delivery evidence could not be saved", evidenceError instanceof Error ? evidenceError.message : String(evidenceError));
        }
      }
      if (sendKeyPressed && !(error instanceof AmbiguousDeliveryError)) {
        throw new AmbiguousDeliveryError("The send key was pressed but delivery verification failed", { cause: error });
      }
      throw error;
    } finally {
      fs.rmSync(before, { force: true });
      fs.rmSync(after, { force: true });
      for (const file of [empty, staged, cleared]) fs.rmSync(file, { force: true });
    }
  }
}
