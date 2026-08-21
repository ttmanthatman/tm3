import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { Rectangle, X11DriverConfig } from "./config.js";
import type { DeliveryEvidence, WeChatDriver } from "./driver.js";
import { AmbiguousDeliveryError, SafeRelayError } from "./errors.js";
import type { QueueItem } from "./queue.js";

interface WindowGeometry {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
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

export class X11WeChatDriver implements WeChatDriver {
  private readonly environment: NodeJS.ProcessEnv;

  constructor(private readonly config: X11DriverConfig) {
    this.environment = { ...process.env, DISPLAY: config.display };
  }

  private execute(command: string, args: string[]) {
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

  private writeClipboard(content: string) {
    return new Promise<void>((resolve, reject) => {
      const child = spawn("xclip", ["-selection", "clipboard"], {
        env: this.environment,
        stdio: ["pipe", "ignore", "pipe"]
      });
      const errors: Buffer[] = [];
      child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`xclip failed: ${Buffer.concat(errors).toString("utf8").trim() || `exit ${code}`}`));
      });
      child.stdin.end(content, "utf8");
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
    const id = ids.at(-1);
    if (!id) throw new SafeRelayError("The official WeChat window is not visible; login may be required");
    const title = await this.execute("xdotool", ["getwindowname", id]);
    if (!title.includes(this.config.windowTitle)) {
      throw new SafeRelayError(`Unexpected window title: ${title || "(empty)"}`);
    }
    await this.execute("xdotool", ["windowsize", "--sync", id, String(this.config.windowWidth), String(this.config.windowHeight)]);
    await this.execute("xdotool", ["windowactivate", "--sync", id]);
    const geometry = await this.execute("xdotool", ["getwindowgeometry", "--shell", id]);
    return parseWindowGeometry(geometry, id);
  }

  private absoluteRegion(window: WindowGeometry, region: Rectangle): Rectangle {
    if (region.x + region.width > window.width || region.y + region.height > window.height) {
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

  async doctor() {
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
    const window = await this.findWindow();
    fs.mkdirSync(path.dirname(this.config.anchorPath), { recursive: true });
    await this.screenshot(this.absoluteRegion(window, this.config.anchorRegion), this.config.anchorPath);
    return this.config.anchorPath;
  }

  async send(item: QueueItem): Promise<DeliveryEvidence> {
    const window = await this.findWindow();
    if (this.config.inputPoint.x >= window.width || this.config.inputPoint.y >= window.height) {
      throw new SafeRelayError("Configured input point falls outside the WeChat window");
    }
    const anchorDifference = await this.verifyTarget(window);
    const messageRegion = this.absoluteRegion(window, this.config.messageRegion);
    const before = this.temporaryImage("before");
    const after = this.temporaryImage("after");
    let sendKeyPressed = false;
    try {
      await this.screenshot(messageRegion, before);
      await this.writeClipboard(item.formattedText);
      await this.execute("xdotool", [
        "mousemove", "--window", window.id,
        String(this.config.inputPoint.x), String(this.config.inputPoint.y),
        "click", "1"
      ]);
      await this.execute("xdotool", ["key", "--window", window.id, "ctrl+v"]);
      await delay(this.config.pasteWaitMs);
      sendKeyPressed = true;
      await this.execute("xdotool", ["key", "--window", window.id, "Return"]);
      await delay(this.config.postSendWaitMs);
      await this.screenshot(messageRegion, after);
      const messageDifference = await imageDifference(before, after);
      if (messageDifference < this.config.messageMinDifference) {
        throw new AmbiguousDeliveryError(
          `The send key was pressed but no sufficient chat-area change was observed (difference ${messageDifference.toFixed(4)})`
        );
      }
      return {
        summary: `target difference ${anchorDifference.toFixed(4)}, chat change ${messageDifference.toFixed(4)}`
      };
    } catch (error) {
      if (sendKeyPressed && !(error instanceof AmbiguousDeliveryError)) {
        throw new AmbiguousDeliveryError("The send key was pressed but delivery verification failed", { cause: error });
      }
      throw error;
    } finally {
      fs.rmSync(before, { force: true });
      fs.rmSync(after, { force: true });
    }
  }
}
