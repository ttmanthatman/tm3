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

test("editing a highlight preserves its color even when note content is cleared", async () => {
  const s = setup();
  s.editor.edit(context, { ...note, color: "#34a853" });
  s.editor.text.value = "";
  await s.editor.save(false);
  assert.equal(s.writes[0].input.color, "#34a853");
  assert.equal(s.writes[0].input.text, "");
  assert.deepEqual(s.deleted, []);
  s.scope.stop();
});


test("unfavorite removes a bare highlight and keeps written or handwritten notes", async () => {
  for (const content of [{ text: "", handwriting: null }, { text: "感言", handwriting: null }, { text: "", handwriting: ink }]) {
    const s = setup();
    s.editor.edit(context, { ...note, ...content, color: "#34a853" });
    await s.editor.unfavorite();
    if (content.text || content.handwriting) {
      assert.equal(s.writes[0].input.color, undefined);
      assert.equal(s.writes[0].input.text, content.text);
      assert.deepEqual(s.writes[0].input.handwriting, content.handwriting);
      assert.deepEqual(s.deleted, []);
    } else assert.deepEqual(s.deleted, [note.id]);
    assert.equal(s.editor.context.value, null);
    assert.deepEqual(s.changed, [1]);
    s.scope.stop();
  }
});

test("explicit deletion removes colored notes and preserves unsaved content on failure", async () => {
  let attempts = 0;
  const s = setup({ remove: async () => { if (++attempts === 1) throw new Error("离线"); return { success: true }; } });
  s.editor.edit(context, { ...note, color: "#34a853" });
  s.editor.text.value = "未保存的想法";
  await s.editor.remove();
  assert.equal(s.editor.text.value, "未保存的想法");
  assert.equal(s.editor.color.value, "#34a853");
  assert.equal(s.editor.error.value, "离线");
  assert.deepEqual(s.changed, []);
  await s.editor.remove();
  assert.equal(s.editor.context.value, null);
  assert.deepEqual(s.changed, [1]);
  s.scope.stop();
});

test("failed unfavorite restores the color and can be retried", async () => {
  const s = setup({ remove: async () => { throw new Error("离线"); } });
  s.editor.edit(context, { ...note, text: "", color: "#34a853" });
  await s.editor.unfavorite();
  assert.equal(s.editor.color.value, "#34a853");
  assert.equal(s.editor.error.value, "离线");
  assert.equal(s.editor.context.value?.bookId, 1);
  assert.deepEqual(s.changed, []);
  s.scope.stop();
});


test("a completed deletion cannot reset or notify a different account's editor", async () => {
  let finish!: (value: { success: true }) => void;
  const s = setup({ remove: () => new Promise(resolve => { finish = resolve; }) });
  s.editor.edit(context, note);
  const pending = s.editor.remove();
  s.account.value = 2;
  s.editor.edit(context);
  s.editor.text.value = "另一个账号的笔记";
  finish({ success: true });
  await pending;
  assert.equal(s.editor.text.value, "另一个账号的笔记");
  assert.deepEqual(s.changed, []);
  s.scope.stop();
});
