import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fetchBlobWithProgress, transferProgress } from "./transfer.js";

test("transferProgress keeps unknown totals indeterminate", () => {
  assert.deepEqual(transferProgress(25, 100), { loaded: 25, total: 100, percent: 25 });
  assert.deepEqual(transferProgress(25, 0), { loaded: 25, total: null, percent: null });
  assert.equal(transferProgress(125, 100).percent, 100);
});

test("fetchBlobWithProgress reports download progress and returns the blob", async () => {
  const original = (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
  const events: Array<{ loaded: number; total: number | null; percent: number | null }> = [];
  let sent = false;
  let aborted = false;
  const response = new Blob([new Uint8Array([1, 2, 3])]);

  class FakeXMLHttpRequest {
    status = 200;
    responseType = "";
    response: Blob | null = null;
    onprogress: ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    private headers = new Map<string, string>();

    open() {}
    setRequestHeader(name: string, value: string) {
      this.headers.set(name, value);
    }
    send() {
      sent = true;
      this.onprogress?.({ loaded: 3, total: 10, lengthComputable: true });
      this.response = response;
      this.onload?.();
    }
    abort() {
      aborted = true;
      this.onabort?.();
    }
  }

  (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = FakeXMLHttpRequest;
  try {
    const blob = await fetchBlobWithProgress("/api/files/1", {
      headers: { Authorization: "Bearer test" },
      onProgress: (progress) => events.push(progress)
    });
    assert.equal(sent, true);
    assert.equal(aborted, false);
    assert.equal(blob, response);
    assert.deepEqual(events, [
      { loaded: 3, total: 10, percent: 30 },
      { loaded: 3, total: 3, percent: 100 }
    ]);
  } finally {
    (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = original;
  }
});

test("preview and download surfaces render the shared progress bar", () => {
  const surfaces = [
    "src/client/features/messages/MediaPreviewModal.vue",
    "src/client/components/AdminResourceManager.vue",
    "src/client/features/chat/ChatRecordView.vue",
    "src/client/features/admin/AdminPanel.vue"
  ];
  for (const surface of surfaces) {
    const source = fs.readFileSync(new URL(`../../../../${surface}`, import.meta.url), "utf8");
    assert.match(source, /TransferProgressBar/, `${surface} should show transfer progress`);
  }
});
