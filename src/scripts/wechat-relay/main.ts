import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRelayConfig } from "./config.js";
import { DryRunDriver, type WeChatDriver } from "./driver.js";
import { ManagedTeamChatSource, type ManagedRelayAction } from "./managedSource.js";
import { RelayProcessLock } from "./processLock.js";
import { RelayQueue } from "./queue.js";
import { WeChatRelay } from "./relay.js";
import { runRelaySetupApp } from "./setupApp.js";
import { formatRelayMessage } from "./formatter.js";
import { TeamChatSource } from "./source.js";
import { X11WeChatDriver } from "./x11Driver.js";

function usage() {
  console.log(`Usage:
  wechat-relay run
  wechat-relay doctor
  wechat-relay calibrate
  wechat-relay setup
  wechat-relay status
  wechat-relay resolve <source-id> <sent|retry>`);
}

function createDriver(config: ReturnType<typeof loadRelayConfig>): WeChatDriver {
  return config.driver === "x11" ? new X11WeChatDriver(config.x11) : new DryRunDriver();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runManagedControl(
  source: ManagedTeamChatSource,
  driver: WeChatDriver,
  queue: RelayQueue,
  intervalMs: number,
  calibratedTargetPath: string
) {
  let driverReady = false;
  let calibratedTarget: string | null = null;
  let lastError: string | null = null;
  const completed = new Map<string, { success: boolean; message: string }>();

  try {
    await driver.doctor();
    driverReady = true;
    calibratedTarget = fs.existsSync(calibratedTargetPath)
      ? fs.readFileSync(calibratedTargetPath, "utf8").trim() || null
      : null;
  } catch (error) {
    lastError = errorMessage(error);
  }

  while (!source.isStopped()) {
    try {
      const control = await source.control();
      for (const event of control.systemEvents) {
        const synced = queue.syncManagedEvent(event, control.enabled, formatRelayMessage);
        if (synced.inserted) console.log(`queued managed system event ${event.slot}`);
      }
      const action = control.pendingAction;
      if (action) {
        let result = completed.get(action.id);
        if (!result) {
          try {
            if (action.type === "calibrate") {
              if (!(driver instanceof X11WeChatDriver)) throw new Error("Only the X11 driver can bind a WeChat group");
              await driver.calibrate();
              await driver.doctor();
              fs.writeFileSync(calibratedTargetPath, `${action.targetGroup}\n`, { mode: 0o600 });
              driverReady = true;
              calibratedTarget = action.targetGroup;
              result = { success: true, message: `已绑定微信群 ${action.targetGroup}` };
            } else {
              if (!driverReady || calibratedTarget !== action.targetGroup) {
                throw new Error("The visible WeChat group is not the bound target; bind it again before testing");
              }
              const evidence = await driver.send(testQueueItem(action));
              result = { success: true, message: `测试消息已发送（${evidence.summary}）` };
            }
          } catch (error) {
            result = { success: false, message: errorMessage(error) };
            lastError = result.message;
          }
          completed.set(action.id, result);
        }
        await source.reportAction(action.id, result.success, result.message);
        if (result.success) lastError = null;
      }
      await source.heartbeat({
        deviceName: "NAS 微信虚拟机",
        driverReady,
        calibratedTarget,
        queue: queue.counts() as Record<string, number>,
        attention: queue.attention().length,
        lastError
      });
    } catch (error) {
      lastError = errorMessage(error);
      console.error(`managed relay control failed: ${lastError}`);
    }
    if (!source.isStopped()) await delay(Math.max(5000, intervalMs));
  }
}

function testQueueItem(action: Extract<ManagedRelayAction, { type: "test" }>) {
  const now = new Date().toISOString();
  return {
    sourceId: 1,
    channelId: 1,
    message: {
      id: 1,
      channelId: 1,
      sender: { id: 1, kind: "system" as const, username: "wechat_relay", displayName: "微信转发" },
      content: action.text,
      type: "system" as const,
      createdAt: now
    },
    formattedText: action.text,
    state: "processing" as const,
    attemptCount: 1,
    nextAttemptAt: 0,
    lastError: null,
    sourceCreatedAt: Date.now()
  };
}

async function main() {
  const command = process.argv[2] || "run";
  if (["help", "--help", "-h"].includes(command)) {
    usage();
    return 0;
  }
  if (command === "setup") return runRelaySetupApp();
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
    const source = config.agentToken
      ? new ManagedTeamChatSource(config.baseUrl, config.agentToken)
      : new TeamChatSource(config);
    const relay = new WeChatRelay(config, queue, source, driver);
    try {
      process.once("SIGINT", () => relay.stop());
      process.once("SIGTERM", () => relay.stop());
      await Promise.all([
        relay.run(),
        source instanceof ManagedTeamChatSource
          ? runManagedControl(source, driver, queue, config.pollIntervalMs, `${config.x11.anchorPath}.target`)
          : Promise.resolve()
      ]);
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
