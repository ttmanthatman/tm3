import { setTimeout as delay } from "node:timers/promises";
import type { MessageDTO } from "../../shared/types.js";
import type { RelayConfig } from "./config.js";
import type { WeChatDriver } from "./driver.js";
import { AmbiguousDeliveryError, SafeRelayError } from "./errors.js";
import { formatRelayMessage } from "./formatter.js";
import { RelayQueue } from "./queue.js";
import { TeamChatSource } from "./source.js";

export interface RelayLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

const defaultLogger: RelayLogger = {
  info: (message) => console.log(`[relay] ${message}`),
  warn: (message) => console.warn(`[relay] ${message}`),
  error: (message) => console.error(`[relay] ${message}`)
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export class WeChatRelay {
  private stopping = false;
  private lastSentAt = 0;

  constructor(
    private readonly config: RelayConfig,
    private readonly queue: RelayQueue,
    private readonly source: TeamChatSource,
    private readonly driver: WeChatDriver,
    private readonly logger: RelayLogger = defaultLogger
  ) {}

  stop() {
    this.stopping = true;
    this.source.close();
  }

  private ingest(messages: readonly MessageDTO[], advanceCursor: boolean) {
    const result = this.queue.ingest(messages, (message) => formatRelayMessage(message, {
      maxContentLength: this.config.maxContentLength,
      messageUrlTemplate: this.config.messageUrlTemplate
    }), { advanceCursor });
    if (result.inserted) this.logger.info(`queued ${result.inserted} message(s), cursor=${result.cursor}`);
  }

  private async sourceLoop() {
    while (!this.stopping) {
      try {
        const catchUpFrom = this.queue.cursor();
        await this.source.ensureSubscription((message) => this.ingest([message], false));
        await this.source.catchUp(catchUpFrom, (messages) => this.ingest(messages, true));
      } catch (error) {
        this.logger.error(`source synchronization failed: ${errorMessage(error)}`);
      }
      if (!this.stopping) await delay(this.config.pollIntervalMs);
    }
  }

  private retryAt(attemptCount: number) {
    const exponent = Math.max(0, Math.min(attemptCount - 1, 8));
    return Date.now() + this.config.retryBaseMs * (2 ** exponent);
  }

  private async deliveryLoop() {
    while (!this.stopping) {
      if (this.queue.hasUncertain()) {
        this.logger.warn("delivery paused because an uncertain message requires manual resolution");
        await delay(Math.max(this.config.idleIntervalMs, 5000));
        continue;
      }
      const item = this.queue.claimNext();
      if (!item) {
        await delay(this.config.idleIntervalMs);
        continue;
      }
      if (Date.now() - item.sourceCreatedAt > this.config.maxMessageAgeMs) {
        this.queue.markExpired(item.sourceId);
        this.logger.warn(`expired source message ${item.sourceId}`);
        continue;
      }
      const sendDelay = Math.max(0, this.config.minSendIntervalMs - (Date.now() - this.lastSentAt));
      if (sendDelay) await delay(sendDelay);
      try {
        const evidence = await this.driver.send(item);
        this.queue.markSent(item.sourceId);
        this.lastSentAt = Date.now();
        this.logger.info(`sent source message ${item.sourceId}: ${evidence.summary}`);
      } catch (error) {
        const message = errorMessage(error);
        if (error instanceof AmbiguousDeliveryError) {
          this.queue.markUncertain(item.sourceId, message);
          this.logger.error(`source message ${item.sourceId} is uncertain: ${message}`);
          continue;
        }
        if (error instanceof SafeRelayError) {
          this.queue.markDeferred(item.sourceId, message, Date.now() + this.config.retryBaseMs);
          this.logger.warn(`source message ${item.sourceId} safely deferred: ${message}`);
          await delay(Math.min(this.config.retryBaseMs, this.config.pollIntervalMs));
          continue;
        }
        const state = this.queue.markRetry(
          item.sourceId,
          message,
          this.config.maxAttempts,
          this.retryAt(item.attemptCount)
        );
        this.logger.error(`source message ${item.sourceId} delivery ${state}: ${message}`);
      }
    }
  }

  async run() {
    try {
      const findings = await this.driver.doctor();
      findings.forEach((finding) => this.logger.info(finding));
    } catch (error) {
      this.logger.warn(`driver is not ready; messages will remain queued: ${errorMessage(error)}`);
    }
    await Promise.all([this.sourceLoop(), this.deliveryLoop()]);
  }
}
