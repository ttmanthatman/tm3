import assert from "node:assert/strict";
import test from "node:test";
import type { CopyworkDTO } from "@shared/bibleCopywork";
import { copyworkExportLayout, createCopyworkExporter } from "./copyworkExport";

function fixture() {
  const cached = new Map<string, Blob>();
  const glyphs = [{ index: 0, character: { strokes: [{ points: [[0, 0, 0] as [number, number, number]] }] }, bounds: { left: 0, top: 0, right: 9000, bottom: 9000 } }];
  const pages = [[{ index: 0, x: 68, y: 110 }]];
  const work = { id: "work", completedAt: "2026-10-07T00:00:00Z" } as CopyworkDTO;
  let allowed = true;
  const counts = { authorize: 0, pages: 0, render: 0 };
  const dependencies = {
    authorize: async () => { counts.authorize++; if (!allowed) throw new Error("不可查看"); return { work, pages }; },
    loadPage: async () => { counts.pages++; return { glyphs }; },
    read: async (key: string) => cached.get(key),
    write: async (key: string, blob: Blob) => { cached.set(key, blob); },
    render: async () => { counts.render++; return new Blob(["png"], { type: "image/png" }); }
  };
  return { dependencies, counts, revoke: () => { allowed = false; }, glyphs, pages };
}

test("exports are lazy, reused across exporter instances, account scoped and reauthorized on every request", async () => {
  const f = fixture();
  const exportImage = createCopyworkExporter(f.dependencies);
  assert.equal(f.counts.render, 0);
  const first = await exportImage(1, "work");
  assert.equal((await exportImage(1, "work")).blob, first.blob);
  assert.equal((await createCopyworkExporter(f.dependencies)(1, "work")).blob, first.blob);
  assert.deepEqual(f.counts, { authorize: 3, pages: 1, render: 1 });
  await exportImage(2, "work");
  assert.equal(f.counts.render, 2);
  f.revoke();
  await assert.rejects(exportImage(1, "work"), /不可查看/);
  assert.equal(f.counts.render, 2);
});

test("unavailable persistent cache reports a warning and still reuses the in-memory image", async () => {
  const f = fixture();
  const exportImage = createCopyworkExporter({ ...f.dependencies,
    read: async () => { throw new Error("disabled"); },
    write: async () => { throw new Error("quota"); }
  });
  assert.match((await exportImage(1, "work")).cacheWarning, /无法保留/);
  await exportImage(1, "work");
  assert.equal(f.counts.render, 1);
});

test("rendering failures can be retried and all pages load before rendering", async () => {
  const f = fixture();
  let failed = true;
  const exportImage = createCopyworkExporter({ ...f.dependencies,
    authorize: async () => ({ ...(await f.dependencies.authorize()), pages: [...f.pages, ...f.pages] }),
    render: async () => { if (failed) { failed = false; throw new Error("render failed"); } return f.dependencies.render(); }
  });
  await assert.rejects(exportImage(1, "work"), /render failed/);
  await exportImage(1, "work");
  assert.equal(f.counts.pages, 4);
});

test("multi-page image layout includes outlying ink with bounded canvas dimensions", () => {
  const f = fixture();
  const one = copyworkExportLayout(f.glyphs, f.pages);
  const many = copyworkExportLayout(f.glyphs, Array.from({ length: 500 }, () => f.pages[0]));
  assert.equal(many.frames.length, 500);
  assert.ok(many.frames[1].y > one.height / one.scale);
  assert.ok(many.height <= 16001);
  assert.ok(many.width * many.height <= 16_020_000);
});
