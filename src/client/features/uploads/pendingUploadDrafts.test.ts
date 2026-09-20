import assert from "node:assert/strict";
import test from "node:test";
import { pendingUploadDraftKey, selectPendingUploadDrafts, type PendingUploadDraft } from "./pendingUploadDrafts.js";

function draft(id: number, accountId: number, channelId: number, createdAt: string): PendingUploadDraft {
  return {
    key: pendingUploadDraftKey(accountId, id),
    id,
    accountId,
    channelId,
    createdAt,
    file: new File([String(id)], `voice-${id}.m4a`, { type: "audio/mp4" }),
    options: { voice: true, durationMs: 12_000 }
  };
}

test("local upload drafts restore only for the same account and channel in original order", () => {
  const selected = selectPendingUploadDrafts([
    draft(-3, 8, 5, "2026-09-20T10:03:00.000Z"),
    draft(-1, 8, 5, "2026-09-20T10:01:00.000Z"),
    draft(-2, 9, 5, "2026-09-20T10:02:00.000Z"),
    draft(-4, 8, 6, "2026-09-20T10:04:00.000Z")
  ], 8, 5);

  assert.deepEqual(selected.map((item) => item.id), [-1, -3]);
  assert.equal(selected[0]?.file.name, "voice--1.m4a");
  assert.equal(selected[0]?.options.voice, true);
});
