import assert from "node:assert/strict";
import { test } from "node:test";
import { effectScope } from "vue";
import type { BibleNoteDTO } from "../../../../shared/bibleNotes.js";
import { useBibleNoteEditor } from "./useBibleNoteEditor.js";
import type { noteApi } from "./noteApi.js";

const selection = { translation: "cmn-cu89s", bookCode: "JHN", chapter: 11, verse: 35 };
const source = { ...selection, translationName: "和合本", copyright: "", verseStart: 35, verseEnd: 35, reference: "约翰福音 11:35", text: "耶稣哭了。" };
const note: BibleNoteDTO = { id: "draft-1", accountId: 1, author: "读者", source, text: "祂与我们一同流泪。", createdAt: "2026-10-08T00:00:00Z", updatedAt: "2026-10-08T00:00:00Z", publishedAt: null };
function setup(overrides: Partial<typeof noteApi> = {}) {
  const creates: Array<{ id: string; text: string; public: boolean }> = [];
  const updates: Array<{ text?: string; public?: boolean }> = [];
  const preferences: boolean[] = [];
  const client: typeof noteApi = {
    source: async () => ({ source }), preferences: async () => ({ alwaysPublic: false }),
    savePreferences: async (value) => { preferences.push(value); return { alwaysPublic: value }; },
    create: async (id, _selection, text, isPublic) => { creates.push({ id, text, public: isPublic }); return { note: { ...note, id, text, publishedAt: isPublic ? note.createdAt : null } }; },
    update: async (_id, change) => { updates.push(change); return { note: { ...note, text: change.text || note.text, publishedAt: change.public ? note.createdAt : null } }; },
    get: async () => ({ note }), recover: async () => ({ note: null }), list: async () => ({ notes: [note], nextOffset: null }), remove: async () => ({ success: true }),
    share: async () => { throw new Error("unused"); }, ...overrides
  };
  const scope = effectScope();
  const editor = scope.run(() => useBibleNoteEditor(client, () => "draft-1"))!;
  return { editor, scope, creates, updates, preferences };
}
test("closing a new note asks to publish with public selected; closing an empty note saves nothing", async () => {
  const s = setup();
  await s.editor.start(selection);
  await s.editor.finish();
  assert.equal(s.editor.editorOpen.value, false);
  assert.deepEqual(s.creates, []);
  await s.editor.start(selection);
  s.editor.text.value = note.text;
  assert.equal(await s.editor.finish(), null);
  assert.equal(s.editor.publicationOpen.value, true);
  assert.equal(s.editor.publish.value, true);
  assert.equal(s.editor.editorOpen.value, true);
  await s.editor.save();
  assert.deepEqual(s.creates, [{ id: "draft-1", text: note.text, public: true }]);
  assert.equal(s.editor.editorOpen.value, false);
  s.scope.stop();
});
test("private choice saves private even when remember checkbox was previously selected", async () => {
  const s = setup();
  await s.editor.start(selection);
  s.editor.text.value = note.text;
  await s.editor.finish();
  s.editor.skipPrompt.value = true;
  s.editor.publish.value = false;
  await s.editor.save();
  assert.equal(s.creates[0].public, false);
  assert.deepEqual(s.preferences, []);
  s.scope.stop();
});
test("remembered public preference skips the next new note prompt", async () => {
  let remembered = false;
  const s = setup({ preferences: async () => ({ alwaysPublic: remembered }), savePreferences: async (value) => { remembered = value; return { alwaysPublic: value }; } });
  await s.editor.start(selection);
  s.editor.text.value = note.text;
  await s.editor.finish();
  s.editor.skipPrompt.value = true;
  await s.editor.save();
  assert.equal(remembered, true);
  await s.editor.start(selection);
  s.editor.text.value = "又一份领受";
  const saved = await s.editor.finish();
  assert.ok(saved?.publishedAt);
  assert.equal(s.editor.publicationOpen.value, false);
  assert.equal(s.creates.length, 2);
  s.scope.stop();
});
test("failed save keeps draft, publication choice and UUID for a safe retry", async () => {
  const keys: string[] = [];
  const s = setup({ create: async (id) => { keys.push(id); if (keys.length === 1) throw new Error("网络断开"); return { note }; } });
  await s.editor.start(selection);
  s.editor.text.value = note.text;
  await s.editor.finish();
  s.editor.publish.value = false;
  assert.equal(await s.editor.save(), null);
  assert.equal(s.editor.text.value, note.text);
  assert.equal(s.editor.publicationOpen.value, true);
  assert.equal(s.editor.error.value, "网络断开");
  assert.equal(s.editor.editorBusy.value, false);
  await s.editor.save();
  assert.deepEqual(keys, ["draft-1", "draft-1"]);
  s.scope.stop();
});
test("editing a private note keeps its visibility despite always-public new-note preference", async () => {
  const s = setup({ preferences: async () => ({ alwaysPublic: true }) });
  await s.editor.start(selection, note);
  s.editor.text.value = "改过的笔记";
  assert.equal(await s.editor.finish(), null);
  assert.equal(s.editor.publish.value, false);
  await s.editor.save();
  assert.deepEqual(s.updates, [{ text: "改过的笔记", public: false }]);
  assert.deepEqual(s.creates, []);
  s.scope.stop();
});
test("source preparation failure can retry without losing text or its existing identity", async () => {
  let attempts = 0;
  const s = setup({ source: async () => { if (++attempts === 1) throw new Error("经文加载失败"); return { source }; } });
  await s.editor.start(selection);
  s.editor.text.value = note.text;
  await s.editor.finish();
  assert.equal(s.editor.publicationOpen.value, false);
  await s.editor.retry();
  assert.equal(s.editor.source.value?.reference, source.reference);
  assert.equal(s.editor.text.value, note.text);
  await s.editor.finish();
  await s.editor.save();
  assert.equal(s.creates[0].id, "draft-1");
  s.scope.stop();
});
test("failure to remember publication preference keeps note unsaved and retryable", async () => {
  const s = setup({ savePreferences: async () => { throw new Error("偏好保存失败"); } });
  await s.editor.start(selection);
  s.editor.text.value = note.text;
  await s.editor.finish();
  s.editor.skipPrompt.value = true;
  assert.equal(await s.editor.save(), null);
  assert.equal(s.editor.error.value, "偏好保存失败");
  assert.equal(s.editor.editorOpen.value, true);
  assert.deepEqual(s.creates, []);
  s.scope.stop();
});
test("account disposal during preference saving prevents saving the old account draft", async () => {
  let resolvePreference!: (value: { alwaysPublic: boolean }) => void;
  const s = setup({ savePreferences: () => new Promise((resolve) => { resolvePreference = resolve; }) });
  await s.editor.start(selection);
  s.editor.text.value = note.text;
  await s.editor.finish();
  s.editor.skipPrompt.value = true;
  const pending = s.editor.save();
  s.scope.stop();
  resolvePreference({ alwaysPublic: true });
  assert.equal(await pending, null);
  assert.deepEqual(s.creates, []);
  assert.deepEqual(s.updates, []);
});
test("a lost create response with revised text and privacy recovers then updates the same note", async () => {
  let recoveryAttempts = 0;
  let creates = 0;
  const s = setup({
    create: async () => { creates++; throw new Error("保存响应丢失"); },
    recover: async () => { if (++recoveryAttempts === 1) throw new Error("暂时无法确认保存结果"); return { note: { ...note, publishedAt: note.createdAt } }; }
  });
  await s.editor.start(selection);
  s.editor.text.value = note.text;
  await s.editor.finish();
  assert.equal(await s.editor.save(), null);
  s.editor.text.value = "修改后的私密领受";
  s.editor.publish.value = false;
  const result = await s.editor.save();
  assert.equal(result?.text, "修改后的私密领受");
  assert.equal(result?.publishedAt, null);
  assert.equal(creates, 1);
  assert.deepEqual(s.updates, [{ text: "修改后的私密领受", public: false }]);
  s.scope.stop();
});
