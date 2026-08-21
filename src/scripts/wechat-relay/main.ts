import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRelayConfig } from "./config.js";
import { DryRunDriver, type WeChatDriver } from "./driver.js";
import { RelayProcessLock } from "./processLock.js";
import { RelayQueue } from "./queue.js";
import { WeChatRelay } from "./relay.js";
import { TeamChatSource } from "./source.js";
import { X11WeChatDriver } from "./x11Driver.js";

function usage() {
  console.log(`Usage:
  wechat-relay run
  wechat-relay doctor
  wechat-relay calibrate
  wechat-relay status
  wechat-relay resolve <source-id> <sent|retry>`);
}

function createDriver(config: ReturnType<typeof loadRelayConfig>): WeChatDriver {
  return config.driver === "x11" ? new X11WeChatDriver(config.x11) : new DryRunDriver();
}

async function main() {
  const command = process.argv[2] || "run";
  if (["help", "--help", "-h"].includes(command)) {
    usage();
    return 0;
  }
  const config = loadRelayConfig();
  const driver = createDriver(config);
  if (command === "doctor") {
    try {
      const findings = await driver.doctor();
      findings.forEach((finding) => console.log(finding));
      return 0;
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      return 1;
    }
  }
  if (command === "calibrate") {
    if (!(driver instanceof X11WeChatDriver)) {
      console.error("RELAY_DRIVER must be x11 for calibration");
      return 2;
    }
    const anchorPath = await driver.calibrate();
    console.log(`Target-group anchor saved to ${anchorPath}`);
    return 0;
  }

  const queue = new RelayQueue(config.databasePath);
  try {
    if (command === "status") {
      console.log(JSON.stringify({
        cursor: queue.cursor(),
        counts: queue.counts(),
        attention: queue.attention()
      }, null, 2));
      return 0;
    }
    if (command === "resolve") {
      const sourceId = Number(process.argv[3]);
      const resolution = process.argv[4];
      if (!Number.isInteger(sourceId) || sourceId <= 0 || (resolution !== "sent" && resolution !== "retry")) {
        usage();
        return 2;
      }
      if (!queue.resolve(sourceId, resolution)) {
        console.error(`Source message ${sourceId} is not in a resolvable state`);
        return 1;
      }
      console.log(`Source message ${sourceId} resolved as ${resolution}`);
      return 0;
    }
    if (command !== "run") {
      usage();
      return 2;
    }

    const lock = new RelayProcessLock(config.databasePath);
    lock.acquire();
    queue.recoverInterruptedDelivery();
    const source = new TeamChatSource(config);
    const relay = new WeChatRelay(config, queue, source, driver);
    try {
      process.once("SIGINT", () => relay.stop());
      process.once("SIGTERM", () => relay.stop());
      await relay.run();
      return 0;
    } finally {
      lock.release();
    }
  } finally {
    queue.close();
  }
}

const entryPoint = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entryPoint === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  );
}
