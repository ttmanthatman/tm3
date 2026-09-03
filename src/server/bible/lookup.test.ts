import assert from "node:assert/strict";
import test from "node:test";
import { bibleCatalog, bibleTranslations, lookupBibleChapter, lookupBibleReference, searchBibleText } from "./lookup.js";

test("Bible catalog exposes all 66 books and 1189 chapters", () => {
  const catalog = bibleCatalog();
  assert.equal(catalog.oldTestament.length, 39);
  assert.equal(catalog.newTestament.length, 27);
  assert.equal([...catalog.oldTestament, ...catalog.newTestament].reduce((total, book) => total + book.chapterCount, 0), 1189);
  assert.deepEqual(catalog.oldTestament[0], { code: "GEN", name: "创世记", chapterCount: 50 });
  assert.deepEqual(catalog.newTestament.at(-1), { code: "REV", name: "启示录", chapterCount: 22 });
});

test("Bible text search returns phrase matches with safe character ranges", () => {
  const result = searchBibleText("神爱世人");
  assert.equal(result.mode, "phrase");
  assert.ok(result.total >= 1);
  const john = result.items.find((item) => item.verse.reference === "约翰福音 3:16");
  assert.ok(john);
  assert.ok(john.matches.some((range) => john.verse.text.slice(range.start, range.end) === "神爱世人"));
});

test("Bible text search falls back to all supplied keywords and paginates", () => {
  const firstPage = searchBibleText("神 世人", 0, 1);
  assert.equal(firstPage.mode, "allTerms");
  assert.equal(firstPage.limit, 1);
  assert.equal(firstPage.items.length, 1);
  assert.ok(firstPage.total >= 1);
  assert.match(firstPage.items[0].verse.text, /神/);
  assert.match(firstPage.items[0].verse.text, /世人/);
  assert.ok(firstPage.items[0].matches.length >= 2);
});

test("cross-chapter lookups preserve canonical chapter and verse order", () => {
  const lookup = lookupBibleReference("创世记 1:31-2:2");
  assert.deepEqual(lookup.verses.map((verse) => verse.reference), ["创世记 1:31", "创世记 2:1", "创世记 2:2"]);
});

test("numbered footnote verses remain directly referenceable", () => {
  const expected = new Map([
    ["马太福音 18:11", "（有古卷加：人子来，为要拯救失丧的人。）"],
    ["马太福音 23:14", "（有古卷加：你们这假冒为善的文士和法利赛人有祸了！因为你们侵吞寡妇的家产，假意做很长的祷告，所以要受更重的刑罚。）"],
    ["马可福音 7:16", "（有古卷加：有耳可听的，就应当听！）"],
    ["马可福音 15:28", "（有古卷加：这就应了经上的话说：他被列在罪犯之中。）"],
    ["路加福音 17:36", "（有古卷加：两个人在田里，要取去一个，撇下一个。）"],
    ["路加福音 23:17", "（有古卷加：每逢这节期，巡抚必须释放一个囚犯给他们。）"],
    ["约翰福音 5:4", "（有古卷加：因为有天使按时下池子搅动那水，水动之后，谁先下去，无论害什么病就痊愈了。）"],
    ["使徒行传 8:37", "（有古卷加：腓利说：「你若是一心相信，就可以。」他回答说：「我信耶稣基督是神的儿子。」）"],
    ["使徒行传 15:34", "（有古卷加：惟有西拉定意仍住在那里。）"],
    ["使徒行传 24:7", "（有古卷加：不料，千夫长吕西亚前来，甚是强横，从我们手中把他夺去，吩咐告他的人到你这里来。）"],
    ["使徒行传 28:29", "（有古卷加：保罗说了这话，犹太人议论纷纷地就走了。）"]
  ]);

  for (const [reference, text] of expected) {
    const lookup = lookupBibleReference(reference);
    assert.deepEqual(lookup.verses.map((verse) => ({ reference: verse.reference, text: verse.text })), [{ reference, text }]);
  }

  assert.deepEqual(
    lookupBibleReference("马太福音 23:13-15").verses.map((verse) => verse.reference),
    ["马太福音 23:13", "马太福音 23:14", "马太福音 23:15"]
  );
});

test("Bible chapters expose every numbered verse in text and layout order", () => {
  const catalog = bibleCatalog();
  for (const book of [...catalog.oldTestament, ...catalog.newTestament]) {
    for (let chapterNumber = 1; chapterNumber <= book.chapterCount; chapterNumber += 1) {
      const chapter = lookupBibleChapter(book.code, chapterNumber);
      const coveredVerseNumbers = new Set<number>();
      for (const verse of chapter.verses) {
        for (let verseNumber = verse.verse; verseNumber <= verse.endVerse; verseNumber += 1) coveredVerseNumbers.add(verseNumber);
      }
      const lastVerseNumber = Math.max(...coveredVerseNumbers);
      assert.deepEqual(
        [...coveredVerseNumbers].sort((left, right) => left - right),
        Array.from({ length: lastVerseNumber }, (_, index) => index + 1),
        `${book.name} ${chapterNumber} has a missing verse number`
      );

      const renderedVerseNumbers = new Set(
        chapter.blocks.flatMap((block) => block.type === "paragraph" ? block.fragments.map((fragment) => fragment.verse.verse) : [])
      );
      assert.deepEqual(
        chapter.verses.map((verse) => verse.verse).filter((verseNumber) => !renderedVerseNumbers.has(verseNumber)),
        [],
        `${book.name} ${chapterNumber} has a verse missing from its structured layout`
      );
    }
  }
});

test("legacy Bible lookups keep the chat-facing verse shape unchanged", () => {
  assert.deepEqual(lookupBibleReference("约翰福音 1:1"), {
    reference: "约翰福音 1:1",
    normalizedReference: "约翰福音 1:1",
    translation: "新标点和合本（简体）",
    sourceId: "cmn-cu89s",
    verses: [{
      book: "约翰福音",
      chapter: 1,
      verse: 1,
      endVerse: 1,
      reference: "约翰福音 1:1",
      text: "太初有道，道与神同在，道就是神。"
    }]
  });
});

test("structured chapters expose headings and source paragraph boundaries", () => {
  const chapter = lookupBibleChapter("JHN", 1);
  assert.equal(chapter.verses.length, 51);
  assert.deepEqual(
    chapter.blocks.filter((block) => block.type === "heading").slice(0, 3),
    [
      { type: "heading", level: 1, text: "道成肉身" },
      { type: "heading", level: 1, text: "施洗约翰的见证" },
      { type: "heading", level: 1, text: "神的羔羊" }
    ]
  );
  const firstParagraph = chapter.blocks.find((block) => block.type === "paragraph");
  assert.equal(firstParagraph?.type, "paragraph");
  if (firstParagraph?.type === "paragraph") {
    assert.deepEqual(firstParagraph.fragments.map((fragment) => fragment.verse.verse), [1, 2, 3, 4, 5]);
  }
});

test("structured chapters separate Psalm descriptions and poetry lines from canonical verses", () => {
  const chapter = lookupBibleChapter("PSA", 3);
  const description = chapter.blocks.find((block) => block.type === "description");
  assert.deepEqual(description, { type: "description", text: "大卫逃避他儿子押沙龙的时候作的诗。" });
  const poetry = chapter.blocks.filter((block) => block.type === "paragraph" && block.style === "poetry");
  assert.ok(poetry.length > chapter.verses.length);
  const firstFragment = poetry[0]?.type === "paragraph" ? poetry[0].fragments[0] : undefined;
  assert.equal(firstFragment?.showVerseNumber, true);
  assert.equal(firstFragment?.text, "耶和华啊，我的敌人何其加增；");
  assert.ok(chapter.verses[0].text.startsWith("大卫逃避他儿子押沙龙的时候作的诗。"));
});

test("structured chapters place mid-verse speaker labels without changing the canonical verse", () => {
  const chapter = lookupBibleChapter("SNG", 5);
  const speaker = chapter.blocks.find((block) => block.type === "speaker" && block.text === "〔耶路撒冷的众女子〕");
  assert.ok(speaker);
  const verse = chapter.verses.find((item) => item.verse === 1);
  assert.ok(verse?.text.includes("〔耶路撒冷的众女子〕"));
  const fragments = chapter.blocks.flatMap((block) => block.type === "paragraph" ? block.fragments : []).filter((fragment) => fragment.verse.verse === 1);
  assert.ok(fragments.every((fragment) => !fragment.text.includes("〔耶路撒冷的众女子〕")));
});

test("translation registry lists 和合本 first and 当代译本 with copyright", () => {
  const translations = bibleTranslations();
  assert.deepEqual(translations.map((item) => item.id), ["cmn-cu89s", "cmncbs"]);
  assert.equal(translations[0].shortName, "和合本");
  assert.equal(translations[1].shortName, "当代译本");
  assert.match(translations[1].copyright || "", /Biblica/);
  assert.match(translations[1].copyright || "", /CC BY-SA 4\.0/);
  assert.ok(bibleCatalog().translations.length >= 2);
});

test("chapter lookup switches text by translation while reference lookup stays on the default", () => {
  const cuv = lookupBibleChapter("JHN", 3);
  const ccb = lookupBibleChapter("JHN", 3, "cmncbs");
  assert.equal(cuv.sourceId, "cmn-cu89s");
  assert.equal(ccb.sourceId, "cmncbs");
  assert.equal(ccb.translation, "当代译本（简体）");
  // 当代译本存在合并节（一节条目覆盖多节），条目数不要求与和合本一致
  assert.ok(ccb.verses.length >= 35);
  assert.ok(ccb.verses.some((verse) => verse.verse <= 36 && verse.endVerse >= 36));
  const ccb316 = ccb.verses.find((verse) => verse.verse === 16);
  assert.match(ccb316?.text || "", /上帝爱世人/);
  assert.match(lookupBibleReference("约翰福音 3:16").verses[0].text, /神爱世人/);
  assert.equal(lookupBibleReference("约翰福音 3:16").sourceId, "cmn-cu89s");
});

test("text search follows the requested translation", () => {
  const ccb = searchBibleText("上帝爱世人", 0, 50, 50, "cmncbs");
  assert.equal(ccb.sourceId, "cmncbs");
  assert.ok(ccb.items.some((item) => item.verse.reference === "约翰福音 3:16"));
  const cuv = searchBibleText("上帝爱世人", 0, 50, 50, "cmn-cu89s");
  assert.equal(cuv.sourceId, "cmn-cu89s");
  assert.equal(cuv.total, 0);
});

test("unknown translation ids are rejected", () => {
  assert.throws(() => lookupBibleChapter("JHN", 3, "kjv"), /unknown bible translation/);
  assert.throws(() => searchBibleText("神", 0, 50, 50, "kjv"), /unknown bible translation/);
  assert.throws(() => bibleCatalog("kjv"), /unknown bible translation/);
});
