import assert from "node:assert/strict";
import test from "node:test";
import { useGracePhotos } from "./useGracePhotos";

Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null } });
function selection(files: File[]): Event { return { target: { files, value: "selected" } } as unknown as Event; }

class DecodableImage {
  naturalWidth = 8;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) { queueMicrotask(() => this.onload?.()); }
}

test("HEIC selection prepares all photos without publishing and releases preview URLs", async () => {
  const originalFetch = globalThis.fetch;
  const originalImage = globalThis.Image;
  const originalRevoke = URL.revokeObjectURL;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const revoked: string[] = [];
  globalThis.Image = DecodableImage as unknown as typeof Image;
  URL.revokeObjectURL = (url) => { revoked.push(url); originalRevoke(url); };
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ base64: btoa("normalized"), contentType: "image/webp" }), { headers: { "content-type": "application/json" } });
  };
  const errors: string[] = [];
  const photos = useGracePhotos(() => 7, () => 0, (error) => errors.push(error));
  try {
    const pending = photos.pick(selection([new File(["heic"], "phone.HEIC", { type: "" }), new File(["png"], "photo.png", { type: "image/png" })]));
    assert.equal(photos.photoBusy.value, true);
    await pending;
    assert.equal(photos.photoBusy.value, false);
    assert.equal(photos.photos.value.length, 2);
    assert.equal(photos.photos.value[0].file.type, "image/webp");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "/api/grace/prepare-image");
    assert.ok(requests[0].init?.body instanceof FormData);
    assert.deepEqual(JSON.parse(String(requests[0].init.body.get("data"))), { channelId: 7 });
    const preview = photos.photos.value[0].url;
    photos.remove(0);
    assert.ok(revoked.includes(preview));
    assert.deepEqual(errors, [""]);
  } finally {
    photos.clear(); globalThis.fetch = originalFetch; globalThis.Image = originalImage; URL.revokeObjectURL = originalRevoke;
  }
});

test("selection enforces combined photo count and size before decoding", async () => {
  let error = "";
  const photos = useGracePhotos(() => 7, () => 8, (value) => { error = value; });
  await photos.pick(selection([new File(["a"], "a.png", { type: "image/png" }), new File(["b"], "b.png", { type: "image/png" })]));
  assert.equal(error, "最多附上 9 张照片");
  assert.equal(photos.photos.value.length, 0);
  await photos.pick(selection([new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.heic")]));
  assert.equal(error, "请选择 10 MB 以内的照片");
});

test("closing during HEIC preparation aborts the request and cannot refill the cleared draft", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true }));
  let error = "";
  const photos = useGracePhotos(() => 7, () => 0, (value) => { error = value; });
  try {
    const pending = photos.pick(selection([new File(["heic"], "phone.heic")]));
    photos.clear();
    await pending;
    assert.equal(photos.photoBusy.value, false);
    assert.equal(photos.photos.value.length, 0);
    assert.equal(error, "");
  } finally { photos.clear(); globalThis.fetch = originalFetch; }
});
