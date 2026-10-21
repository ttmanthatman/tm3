import assert from "node:assert/strict";
import test from "node:test";
import { BIBLE_PASSAGE_MAX, biblePassageMessageContent, biblePassageMessagePayload } from "../../shared/biblePassages.js";
import { lookupBibleReference } from "../bible/lookup.js";
import { BiblePassageValidationError, cleanBiblePassagePayload } from "./biblePassages.js";
import { messageSendRequestHash } from "./messageSendIdempotency.js";

const draft = { kind: "bible_passage", sourceId: "cmn-cu89s", showTranslation: true, references: ["约翰福音 3:16", "诗篇 23:1"] };

test("Bible passage cleaner keeps selection order and derives all text from the requested source", () => {
  const payload = cleanBiblePassagePayload({ ...draft, sourceId: "cmncbs", references: [" 约 3:16 ", "诗 23:1", "约 3:16"] });
  assert.equal(payload.sourceId, "cmncbs");
  assert.equal(payload.translation, "当代译本（简体）");
  assert.deepEqual(payload.passages.map((passage) => passage.reference), ["约翰福音 3:16", "诗篇 23:1", "约翰福音 3:16"]);
  assert.equal(payload.passages[0].text, `3:16 ${lookupBibleReference("约 3:16", "cmncbs").verses[0].text}`);
  assert.match(payload.passages[0].text, /上帝爱世人/);
  assert.deepEqual(biblePassageMessagePayload(payload), payload);
});

test("Bible passage cleaner preserves chapter and merged-verse labels", () => {
  const payload = cleanBiblePassagePayload({ ...draft, references: ["创世记 1:31-2:2"] });
  assert.match(payload.passages[0].text, /^1:31 /);
  assert.match(payload.passages[0].text, /\n2:1 /);
  assert.match(payload.passages[0].text, /\n2:2 /);
});

test("forwarded Bible passage payloads are revalidated instead of trusting text or translation", () => {
  const payload = cleanBiblePassagePayload(draft);
  const forwarded = cleanBiblePassagePayload({ ...payload, translation: "伪造译本", passages: payload.passages.map((passage) => ({ ...passage, text: "<script>伪造正文</script>" })) });
  assert.deepEqual(forwarded, payload);
  const sendInput = (value: typeof payload) => ({ channelId: 7, type: "text", replyToId: null, content: biblePassageMessageContent(value), payload: value });
  assert.equal(messageSendRequestHash(sendInput(forwarded)), messageSendRequestHash(sendInput(payload)));
});

test("Bible passage cleaner rejects invalid sources, references and counts without partial success", () => {
  for (const input of [
    null, { ...draft, kind: "text" }, { ...draft, sourceId: "unknown" }, { ...draft, sourceId: "" },
    { ...draft, showTranslation: 1 }, { ...draft, references: [] }, { ...draft, references: ["  "] },
    { ...draft, references: ["约翰福音 3:16", "无效经文"] }, { ...draft, references: ["诗篇 23:999"] },
    { ...draft, references: ["诗篇 23:1", 1] }, { ...draft, references: ["诗篇".repeat(100)] },
    { ...draft, references: Array.from({ length: BIBLE_PASSAGE_MAX + 1 }, () => "诗篇 23:1") },
    { ...draft, references: undefined, passages: [{ reference: "诗篇 23:1" }, null] }
  ]) assert.throws(() => cleanBiblePassagePayload(input), (error: unknown) => error instanceof BiblePassageValidationError && error.statusCode === 400);
});

test("Bible passage cleaner rejects a full message exceeding the content limit", () => {
  assert.throws(() => cleanBiblePassagePayload({ ...draft, references: ["诗篇 119", "诗篇 119", "诗篇 119"] }), /内容过长/);
});

test("Bible passage cleaner rejects expanded references that the lookup route cannot reopen", () => {
  assert.throws(() => cleanBiblePassagePayload({ ...draft, references: [Array.from({ length: 15 }, () => "约3:16").join(";")] }), /引用过长/);
});
