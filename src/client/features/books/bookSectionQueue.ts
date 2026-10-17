/** Two preparations at most; foreground targets precede queued speculative work. */
export function createBookSectionQueue(limit = 2) {
  type Task = { key: number; foreground: boolean; run: () => Promise<void>; resolve: () => void; reject: (error: unknown) => void; promise: Promise<void> };
  const queued: Task[] = [];
  const tasks = new Map<number, Task>();
  let active = 0, stopped = false;
  const pump = () => {
    while (!stopped && active < limit && queued.length) {
      queued.sort((a, b) => Number(b.foreground) - Number(a.foreground));
      const task = queued.shift()!;
      active++;
      void task.run().then(task.resolve, task.reject).finally(() => { active--; tasks.delete(task.key); pump(); });
    }
  };
  return {
    run(key: number, run: () => Promise<void>, foreground = false): Promise<void> {
      if (stopped) return Promise.resolve();
      const existing = tasks.get(key);
      if (existing) { existing.foreground ||= foreground; return existing.promise; }
      let resolve!: () => void, reject!: (error: unknown) => void;
      const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      const task = { key, foreground, run, resolve, reject, promise };
      tasks.set(key, task); queued.push(task); pump(); return promise;
    },
    retain(keep: (key: number) => boolean) {
      for (let i = queued.length - 1; i >= 0; i--) if (!keep(queued[i]!.key)) {
        const [task] = queued.splice(i, 1); tasks.delete(task!.key); task!.resolve();
      }
    },
    destroy() {
      stopped = true;
      for (const task of queued.splice(0)) { tasks.delete(task.key); task.resolve(); }
    }
  };
}
