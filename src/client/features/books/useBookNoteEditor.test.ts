import assert from "node:assert/strict";
import test from "node:test";
import { effectScope, ref } from "vue";
import type { BookNoteDTO, BookNoteInput } from "@shared/bookNotes";
import type { bookNotesClient } from "./bookNotesClient";
import { useBookNoteEditor } from "./useBookNoteEditor";
const context = { bookId: 1, title: "示例", quote: "原文", chapter: "第一章", fraction: .2 };
const note: BookNoteDTO = { ...context, id: "312edcba-d5ae-4a3a-a35b-c805e4a56a00", bookTitle: context.title, text: "旧笔记", createdAt: "2026-10-15T00:00:00Z", updatedAt: "2026-10-15T00:00:00Z" };
const ink = { kind: "handwriting" as const, version: 1 as const, characters: [{ strokes: [{ color: "#123456" as const, points: [[1000, 2000, 0], [3000, 4000, 25]] as [number, number, number][] }] }] };
function setup(overrides: Partial<typeof bookNotesClient> = {}) {
  const account = ref<number | undefined>(1), changed: number[] = [], writes: Array<{ id: string; input: BookNoteInput }> = [], deleted: string[] = [];
  const client: typeof bookNotesClient = {
    list: async () => ({ notes: [] }),
    save: async (_book, id, input) => { writes.push({ id, input }); return { note: { ...note, ...input, id } }; },
    remove: async (_book, id) => { deleted.push(id); return { success: true }; }, ...overrides
  };
  const scope = effectScope();
  const editor = scope.run(() => useBookNoteEditor({ accountId: () => account.value, changed: (id) => changed.push(id), client }))!;
  return { editor, scope, account, changed, writes, deleted };
}
test("outside-close saves nonempty content as a draft; whitespace creates no note or marker", async () => {
  const s = setup(); s.editor.edit(context); s.editor.text.value = " \n ";
  await s.editor.close(); assert.equal(s.editor.context.value, null); assert.equal(s.writes.length, 0); assert.equal(s.changed.length, 0);
  s.editor.edit(context); s.editor.text.value = "想法"; await s.editor.close();
  assert.equal(s.editor.context.value, null); assert.equal(s.writes[0].input.draft, true); assert.deepEqual(s.changed, [1]); s.scope.stop();
});
test("handwriting alone counts as content and explicit saves complete drafts", async () => {
  const s = setup(); s.editor.edit(context); s.editor.handwriting.value = ink; await s.editor.close();
  assert.deepEqual(s.writes[0].input.handwriting, ink); assert.equal(s.writes[0].input.text, "");
  s.editor.edit(context, { ...note, draft: true, handwriting: ink }); const saved = await s.editor.save(false);
  assert.equal(saved?.draft, false); assert.deepEqual(saved?.handwriting, ink); s.scope.stop();
});
test("failure keeps the editor and draft; retry reuses the same note ID", async () => {
  const attempts: string[] = [];
  const s = setup({ save: async (_book, id, input) => { attempts.push(id); if (attempts.length === 1) throw new Error("网络中断"); return { note: { ...note, ...input, id } }; } });
  s.editor.edit(context); s.editor.text.value = "保留"; await s.editor.close();
  assert.equal(s.editor.context.value?.bookId, 1); assert.equal(s.editor.text.value, "保留"); assert.match(s.editor.error.value, /网络中断/); assert.equal(s.editor.busy.value, false);
  await s.editor.close(); assert.equal(attempts[0], attempts[1]); assert.equal(s.editor.context.value, null); s.scope.stop();
});
test("unchanged notes close without writing; clearing all content removes the old marker", async () => {
  const s = setup(); s.editor.edit(context, note); await s.editor.close(); assert.equal(s.writes.length, 0);
  s.editor.edit(context, note); s.editor.text.value = ""; await s.editor.close(); assert.deepEqual(s.deleted, [note.id]); assert.deepEqual(s.changed, [1]); s.scope.stop();
});
test("in-flight saves cannot close a different account's editor, emit markers or share private content", async () => {
  let finish!: (value: { note: BookNoteDTO }) => void;
  const s = setup({ save: () => new Promise((resolve) => { finish = resolve; }) });
  s.editor.edit(context); s.editor.text.value = "账号一"; const pending = s.editor.save(false);
  s.account.value = 2; s.editor.edit(context); s.editor.text.value = "账号二";
  finish({ note }); assert.equal(await pending, null);
  assert.equal(s.editor.text.value, "账号二"); assert.equal(s.changed.length, 0); s.scope.stop();
});
