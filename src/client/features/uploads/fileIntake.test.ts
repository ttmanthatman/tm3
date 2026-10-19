import assert from "node:assert/strict";
import test from "node:test";
import { clipboardUploadFiles, dataTransferHasFiles, filesFromDataTransfer } from "./fileIntake.js";

function fakeClipboardItem(kind: string, type: string, file: File | null) {
  return { kind, type, getAsFile: () => file };
}

function fakeTransfer({ items = [], files = [], types = [] }: { items?: Array<{ kind: string; type: string; file: File | null }>; files?: File[]; types?: string[] } = {}) {
  return {
    items: items.map(({ kind, type, file }) => fakeClipboardItem(kind, type, file)),
    files,
    types
  } as unknown as DataTransfer;
}

test("pasted screenshots without a name get a timestamped image name", () => {
  const screenshot = new File([new Uint8Array([1, 2, 3])], "", { type: "image/png" });
  const files = clipboardUploadFiles(fakeTransfer({ items: [{ kind: "file", type: "image/png", file: screenshot }] }));

  assert.equal(files.length, 1);
  assert.match(files[0]!.name, /^粘贴图片-\d+-1\.png$/);
  assert.equal(files[0]!.type, "image/png");
});

test("pasted files keep their original names, images included", () => {
  const photo = new File([new Uint8Array([1])], "holiday.jpg", { type: "image/jpeg" });
  const pdf = new File([new Uint8Array([2])], "笔记.pdf", { type: "application/pdf" });
  const files = clipboardUploadFiles(fakeTransfer({
    items: [
      { kind: "string", type: "text/plain", file: null },
      { kind: "file", type: "image/jpeg", file: photo },
      { kind: "file", type: "application/pdf", file: pdf }
    ]
  }));

  assert.deepEqual(files.map((file) => file.name), ["holiday.jpg", "笔记.pdf"]);
});

test("pure text pastes collect no upload files", () => {
  assert.deepEqual(clipboardUploadFiles(fakeTransfer({ items: [{ kind: "string", type: "text/plain", file: null }] })), []);
  assert.deepEqual(clipboardUploadFiles(null), []);
});

test("clipboard files fall back to the flat file list when items are unavailable", () => {
  const audio = new File([new Uint8Array([3])], "song.mp3", { type: "audio/mpeg" });
  const files = clipboardUploadFiles(fakeTransfer({ files: [audio] }));

  assert.deepEqual(files.map((file) => file.name), ["song.mp3"]);
});

test("only drags that carry real files are treated as file drops", () => {
  assert.equal(dataTransferHasFiles(fakeTransfer({ types: ["Files"] })), true);
  assert.equal(dataTransferHasFiles(fakeTransfer({ types: ["text/plain", "Files"] })), true);
  assert.equal(dataTransferHasFiles(fakeTransfer({ types: ["text/uri-list"] })), false);
  assert.equal(dataTransferHasFiles(null), false);
});

test("dropped files are extracted from the data transfer file list", () => {
  const first = new File([new Uint8Array([1])], "a.txt", { type: "text/plain" });
  const second = new File([new Uint8Array([2])], "b.png", { type: "image/png" });

  assert.deepEqual(filesFromDataTransfer(fakeTransfer({ files: [first, second] })), [first, second]);
  assert.deepEqual(filesFromDataTransfer(null), []);
});
