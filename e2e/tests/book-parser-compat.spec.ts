import { expect, test } from "@playwright/test";

const files: Record<string, string> = {
  "META-INF/container.xml": `<?xml version="1.0"?>
    <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
      <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
    </container>`,
  "OEBPS/content.opf": `<?xml version="1.0"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="uid">urn:e2e:android-group-by</dc:identifier>
        <dc:title id="title">旧版安卓阅读回归</dc:title>
        <meta refines="#title" property="title-type">main</meta>
        <dc:creator id="author">测试作者</dc:creator>
        <meta refines="#author" property="role" scheme="marc:relators">aut</meta>
        <meta refines="#author" property="file-as">Author, Test</meta>
        <dc:language>zh</dc:language>
        <meta property="rendition:layout">reflowable</meta>
      </metadata>
      <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
      <spine><itemref idref="chapter"/></spine>
    </package>`,
  "OEBPS/chapter.xhtml": `<?xml version="1.0"?>
    <html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head>
      <body><h1>第一章</h1><p>旧版安卓也能打开正文。</p></body></html>`
};

for (const entry of ["reader", "preload", "workspace"] as const) {
  test(`EPUB metadata opens without either groupBy API through ${entry}`, async ({ page }) => {
    // A source response provides the app's origin without bootstrapping the app.
    await page.goto("/src/client/books/reader.ts");
    const result = await page.evaluate(async ({ files, entry }) => {
      Object.defineProperty(Object, "groupBy", { value: undefined, configurable: true, writable: true });
      Object.defineProperty(Map, "groupBy", { value: undefined, configurable: true, writable: true });
      const paths = {
        reader: "/src/client/books/reader.ts",
        preload: "/src/client/features/idlePreload.ts",
        workspace: "/src/client/components/BookWorkspace.vue"
      };
      await import(paths[entry]);
      const source = "/src/client/books/reader.ts";
      const { createEpubBook } = await import(source) as typeof import("../../src/client/books/reader");
      const book = await createEpubBook({
        entries: [],
        loadText: async name => files[name] ?? null,
        loadBlob: async name => files[name] ? new Blob([files[name]], { type: "application/xhtml+xml" }) : null,
        getSize: name => files[name]?.length ?? 0
      });
      try {
        const url = await book.sections[0].load();
        if (!url) throw new Error("Missing chapter URL");
        const chapter = new DOMParser().parseFromString(await (await fetch(url)).text(), "text/html");
        return { metadata: book.metadata, sections: book.sections.length, chapter: chapter.body.textContent };
      } finally { book.destroy?.(); }
    }, { files, entry });
    expect(result.metadata).toMatchObject({
      title: "旧版安卓阅读回归",
      language: "zh",
      author: { name: "测试作者", sortAs: "Author, Test", role: "aut" }
    });
    expect(result.sections).toBe(1);
    expect(result.chapter).toContain("旧版安卓也能打开正文。");
  });
}
