import type { FoliateView } from "../../books/reader";

const views = new WeakMap<FoliateView, Map<number, Promise<boolean>>>();
/** Each speculative section owns exactly one Foliate reference, released on eviction. */
export function preloadBookNeighbors(view: FoliateView, index: number): void {
  const sections = view.book?.sections;
  if (!sections?.length) return;
  const tasks = views.get(view) ?? new Map<number, Promise<boolean>>();
  views.set(view, tasks);
  const wanted = new Set([index - 1, index + 1].filter(i => i >= 0 && i < sections.length && sections[i].linear !== "no"));
  for (const [previous, promise] of tasks) if (!wanted.has(previous)) {
    tasks.delete(previous);
    void promise.then(acquired => { if (acquired) sections[previous]?.unload?.(); });
  }
  for (const next of wanted) if (!tasks.has(next)) {
    const task = sections[next].load().then(src => !!src, error => {
      if (tasks.get(next) === task) tasks.delete(next);
      console.warn("相邻章节预取失败", error);
      return false;
    });
    tasks.set(next, task);
  }
}
export function clearBookNeighborPreloads(view: FoliateView): void {
  const tasks = views.get(view), sections = view.book?.sections;
  views.delete(view);
  if (!tasks || !sections) return;
  for (const [index, promise] of tasks) void promise.then(acquired => { if (acquired) sections[index]?.unload?.(); });
  tasks.clear();
}
