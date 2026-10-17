import assert from "node:assert/strict";
import test from "node:test";
import { clearBookNeighborPreloads, preloadBookNeighbors } from "./bookAdjacentPreload";
import type { FoliateView } from "../../books/reader";

test("paginated speculative references are deduplicated and released on advance/close", async () => {
  const acquired = new Map<number, number>();
  const view = { book: { sections: Array.from({ length: 100 }, (_, index) => ({ async load() { acquired.set(index, (acquired.get(index) ?? 0) + 1); return "blob:fixture"; }, unload() { acquired.set(index, acquired.get(index)! - 1); } })) } } as unknown as FoliateView;
  for (let i = 1; i < 99; i++) {
    preloadBookNeighbors(view, i); preloadBookNeighbors(view, i);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal([...acquired.values()].reduce((sum, value) => sum + value, 0), 2);
  }
  clearBookNeighborPreloads(view);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal([...acquired.values()].reduce((sum, value) => sum + value, 0), 0);
});
