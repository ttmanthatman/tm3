import { setTimeout as delay } from "node:timers/promises";
import type { MessageDTO } from "../../shared/types.js";
import type { RelayConfig } from "./config.js";
import type { WeChatDriver } from "./driver.js";
import { AmbiguousDeliveryError, SafeRelayError } from "./errors.js";
import { formatRelayMessage } from "./formatter.js";
import { RelayQueue } from "./queue.js";
import type { RelaySource } from "./source.js";

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
  private sourceError: string | null = null;
  private deliveryError: string | null = null;
  private readonly shutdown = new AbortController();

  constructor(
    private readonly config: RelayConfig,
    private readonly queue: RelayQueue,
    private readonly source: RelaySource,
    private readonly driver: WeChatDriver,
    private readonly logger: RelayLogger = defaultLogger
  ) {}

  stop() {
    this.stopping = true;
    this.shutdown.abort();
    this.source.close();
    this.driver.stop?.();
  }

  lastError() {
    return this.sourceError ?? this.deliveryError;
  }

  private async wait(ms: number) {
    try {
      await delay(ms, undefined, { signal: this.shutdown.signal });
    } catch (error) {
      if (!this.shutdown.signal.aborted) throw error;
    }
  }

  private ingest(messages: readonly MessageDTO[], advanceCursor: boolean) {
    const result = this.queue.ingest(messages, (message) => formatRelayMessage(message), { advanceCursor });
    if (result.inserted) this.logger.info(`queued ${result.inserted} message(s), cursor=${result.cursor}`);
  }

  private async sourceLoop() {
    while (!this.stopping) {
      try {
        const catchUpFrom = this.queue.cursor();
        await this.source.ensureSubscription((message) => this.ingest([message], false));
        await this.source.catchUp(catchUpFrom, (messages) => this.ingest(messages, true));
        this.sourceError = null;
      } catch (error) {
        if (!this.stopping) {
          this.sourceError = errorMessage(error);
          this.logger.error(`source synchronization failed: ${this.sourceError}`);
        }
      }
      if (!this.stopping) await this.wait(this.config.pollIntervalMs);
    }
  }

  private retryAt(attemptCount: number) {
    const exponent = Math.max(0, Math.min(attemptCount - 1, 8));
    return Date.now() + this.config.retryBaseMs * (2 ** exponent);
  }

  private async deliveryLoop() {
    while (!this.stopping) {
      if (this.source.deliveryEnabled?.() === false) {
        await this.wait(this.config.idleIntervalMs);
        continue;
      }
      if (this.queue.hasUncertain()) {
        this.logger.warn("delivery paused because an uncertain message requires manual resolution");
        await this.wait(Math.max(this.config.idleIntervalMs, 5000));
        continue;
      }
      const item = this.queue.claimNext();
      if (!item) {
        await this.wait(this.config.idleIntervalMs);
        continue;
      }
      if (Date.now() - item.sourceCreatedAt > this.config.maxMessageAgeMs) {
        this.queue.markExpired(item.sourceId);
        this.logger.warn(`expired source message ${item.sourceId}`);
        continue;
      }
      const sendDelay = Math.max(0, this.config.minSendIntervalMs - (Date.now() - this.lastSentAt));
      if (sendDelay) await this.wait(sendDelay);
      if (this.stopping || this.source.deliveryEnabled?.() === false) {
        this.queue.markDeferred(item.sourceId, "Relay stopped before delivery began", 0);
        if (this.stopping) break;
        continue;
      }
      try {
        const evidence = await this.driver.send(item);
        this.queue.markSent(item.sourceId);
        this.deliveryError = null;
        this.lastSentAt = Date.now();
        this.logger.info(`sent source message ${item.sourceId}: ${evidence.summary}`);
      } catch (error) {
        const message = errorMessage(error);
        this.deliveryError = message;
        if (error instanceof AmbiguousDeliveryError) {
          this.queue.markUncertain(item.sourceId, message);
          this.logger.error(`source message ${item.sourceId} is uncertain: ${message}`);
          continue;
        }
        if (error instanceof SafeRelayError) {
          this.queue.markDeferred(item.sourceId, message, Date.now() + this.config.retryBaseMs);
          this.logger.warn(`source message ${item.sourceId} safely deferred: ${message}`);
          await this.wait(Math.min(this.config.retryBaseMs, this.config.pollIntervalMs));
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
