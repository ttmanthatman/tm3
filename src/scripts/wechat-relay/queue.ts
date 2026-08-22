import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import type { MessageDTO } from "../../shared/types.js";

export type DeliveryState = "pending" | "processing" | "sent" | "failed" | "uncertain" | "expired";

export interface QueueItem {
  sourceId: number;
  channelId: number;
  message: MessageDTO;
  formattedText: string;
  state: DeliveryState;
  attemptCount: number;
  nextAttemptAt: number;
  lastError: string | null;
  sourceCreatedAt: number;
}

export interface ManagedQueueEvent {
  slot: string;
  key: string;
  message: MessageDTO | null;
}

interface QueueRow {
  source_id: number;
  channel_id: number;
  payload_json: string;
  formatted_text: string;
  state: DeliveryState;
  attempt_count: number;
  next_attempt_at: number;
  last_error: string | null;
  source_created_at: number;
}

function rowToItem(row: QueueRow): QueueItem {
  return {
    sourceId: row.source_id,
    channelId: row.channel_id,
    message: JSON.parse(row.payload_json) as MessageDTO,
    formattedText: row.formatted_text,
    state: row.state,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    sourceCreatedAt: row.source_created_at
  };
}

export class RelayQueue {
  private readonly database: Database.Database;

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS relay_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS relay_outbox (
        source_id INTEGER PRIMARY KEY,
        channel_id INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        formatted_text TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'processing', 'sent', 'failed', 'uncertain', 'expired')),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        source_created_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        sent_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS relay_outbox_ready_idx
        ON relay_outbox (state, next_attempt_at, source_id);
    `);
  }

  close() {
    this.database.close();
  }

  recoverInterruptedDelivery() {
    const now = Date.now();
    this.database.prepare(`
      UPDATE relay_outbox
      SET state = 'uncertain',
          last_error = 'Relay stopped while delivery was in progress; manual resolution required',
          updated_at = ?
      WHERE state = 'processing'
    `).run(now);
  }

  cursor() {
    const row = this.database.prepare("SELECT value FROM relay_meta WHERE key = 'source_cursor'").get() as { value: string } | undefined;
    return Number(row?.value || 0);
  }

  private metaValue(key: string) {
    const row = this.database.prepare("SELECT value FROM relay_meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  }

  private setMetaValue(key: string, value: string) {
    this.database.prepare(`
      INSERT INTO relay_meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  syncManagedEvent(event: ManagedQueueEvent, enabled: boolean, format: (message: MessageDTO) => string) {
    const metaKey = `managed_event:${event.slot}`;
    const previous = this.metaValue(metaKey);
    if (previous === event.key) return { changed: false, inserted: 0 };
    let inserted = 0;
    if (previous !== undefined && enabled && event.message) {
      const digest = crypto.createHash("sha256").update(`${event.slot}\0${event.key}`).digest("hex").slice(0, 12);
      const sourceId = 4_000_000_000_000_000 + Number.parseInt(digest, 16);
      const result = this.ingest([{ ...event.message, id: sourceId }], format, { advanceCursor: false });
      inserted = result.inserted;
    }
    this.setMetaValue(metaKey, event.key);
    return { changed: true, inserted };
  }

  ingest(
    messages: readonly MessageDTO[],
    format: (message: MessageDTO) => string,
    options: { advanceCursor?: boolean } = {}
  ) {
    if (!messages.length) return { inserted: 0, cursor: this.cursor() };
    const ordered = [...messages].sort((left, right) => left.id - right.id);
    const insert = this.database.prepare(`
      INSERT OR IGNORE INTO relay_outbox (
        source_id, channel_id, payload_json, formatted_text, state,
        attempt_count, next_attempt_at, source_created_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pending', 0, 0, ?, ?, ?)
    `);
    const setCursor = this.database.prepare(`
      INSERT INTO relay_meta (key, value) VALUES ('source_cursor', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    const transaction = this.database.transaction(() => {
      const now = Date.now();
      let inserted = 0;
      for (const message of ordered) {
        const sourceCreatedAt = Date.parse(message.createdAt);
        const result = insert.run(
          message.id,
          message.channelId,
          JSON.stringify(message),
          format(message),
          Number.isFinite(sourceCreatedAt) ? sourceCreatedAt : now,
          now,
          now
        );
        inserted += result.changes;
      }
      const cursor = options.advanceCursor === false
        ? this.cursor()
        : Math.max(this.cursor(), ordered.at(-1)?.id || 0);
      if (options.advanceCursor !== false) setCursor.run(String(cursor));
      return { inserted, cursor };
    });
    return transaction();
  }

  claimNext(now = Date.now()): QueueItem | null {
    const transaction = this.database.transaction(() => {
      const row = this.database.prepare(`
        SELECT source_id, channel_id, payload_json, formatted_text, state,
               attempt_count, next_attempt_at, last_error, source_created_at
        FROM relay_outbox
        WHERE state = 'pending' AND next_attempt_at <= ?
        ORDER BY source_id ASC
        LIMIT 1
      `).get(now) as QueueRow | undefined;
      if (!row) return null;
      this.database.prepare(`
        UPDATE relay_outbox
        SET state = 'processing', attempt_count = attempt_count + 1, updated_at = ?
        WHERE source_id = ? AND state = 'pending'
      `).run(now, row.source_id);
      return rowToItem({ ...row, state: "processing", attempt_count: row.attempt_count + 1 });
    });
    return transaction();
  }

  markSent(sourceId: number, now = Date.now()) {
    this.database.prepare(`
      UPDATE relay_outbox
      SET state = 'sent', last_error = NULL, sent_at = ?, updated_at = ?
      WHERE source_id = ? AND state = 'processing'
    `).run(now, now, sourceId);
  }

  markUncertain(sourceId: number, error: string, now = Date.now()) {
    this.database.prepare(`
      UPDATE relay_outbox
      SET state = 'uncertain', last_error = ?, updated_at = ?
      WHERE source_id = ? AND state = 'processing'
    `).run(error, now, sourceId);
  }

  markExpired(sourceId: number, now = Date.now()) {
    this.database.prepare(`
      UPDATE relay_outbox
      SET state = 'expired', last_error = 'Message exceeded configured maximum age', updated_at = ?
      WHERE source_id = ? AND state = 'processing'
    `).run(now, sourceId);
  }

  markRetry(sourceId: number, error: string, maxAttempts: number, retryAt: number, now = Date.now()) {
    const row = this.database.prepare("SELECT attempt_count FROM relay_outbox WHERE source_id = ?").get(sourceId) as { attempt_count: number } | undefined;
    const state: DeliveryState = (row?.attempt_count || 0) >= maxAttempts ? "failed" : "pending";
    this.database.prepare(`
      UPDATE relay_outbox
      SET state = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
      WHERE source_id = ? AND state = 'processing'
    `).run(state, retryAt, error, now, sourceId);
    return state;
  }

  markDeferred(sourceId: number, error: string, retryAt: number, now = Date.now()) {
    this.database.prepare(`
      UPDATE relay_outbox
      SET state = 'pending',
          attempt_count = MAX(0, attempt_count - 1),
          next_attempt_at = ?,
          last_error = ?,
          updated_at = ?
      WHERE source_id = ? AND state = 'processing'
    `).run(retryAt, error, now, sourceId);
  }

  resolve(sourceId: number, resolution: "sent" | "retry", now = Date.now()) {
    const result = resolution === "sent"
      ? this.database.prepare(`
          UPDATE relay_outbox
          SET state = 'sent', last_error = NULL, sent_at = ?, updated_at = ?
          WHERE source_id = ? AND state = 'uncertain'
        `).run(now, now, sourceId)
      : this.database.prepare(`
          UPDATE relay_outbox
          SET state = 'pending', next_attempt_at = 0, last_error = NULL, updated_at = ?
          WHERE source_id = ? AND state IN ('uncertain', 'failed')
        `).run(now, sourceId);
    return result.changes === 1;
  }

  hasUncertain() {
    const row = this.database.prepare("SELECT 1 AS found FROM relay_outbox WHERE state = 'uncertain' LIMIT 1").get() as { found: number } | undefined;
    return Boolean(row);
  }

  counts() {
    const rows = this.database.prepare("SELECT state, COUNT(*) AS count FROM relay_outbox GROUP BY state").all() as Array<{ state: DeliveryState; count: number }>;
    return Object.fromEntries(rows.map((row) => [row.state, row.count])) as Partial<Record<DeliveryState, number>>;
  }

  attention() {
    return this.database.prepare(`
      SELECT source_id AS sourceId, state, last_error AS lastError
      FROM relay_outbox
      WHERE state IN ('uncertain', 'failed')
      ORDER BY source_id ASC
    `).all() as Array<{ sourceId: number; state: "uncertain" | "failed"; lastError: string | null }>;
  }

  item(sourceId: number) {
    const row = this.database.prepare(`
      SELECT source_id, channel_id, payload_json, formatted_text, state,
             attempt_count, next_attempt_at, last_error, source_created_at
      FROM relay_outbox WHERE source_id = ?
    `).get(sourceId) as QueueRow | undefined;
    return row ? rowToItem(row) : null;
  }
}
