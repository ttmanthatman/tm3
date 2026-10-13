/** One asynchronous writer coalesces rewrites by position. It never blocks input. */
export function createCopyworkUploadQueue(deps: {
  create: (id: string, spacing: string) => Promise<{ completed: boolean }>;
  put: (id: string, index: number, body: string) => Promise<unknown>;
  status: (pending: number) => void;
  error: (error: unknown) => void;
}) {
  let work: { id: string; spacing: string; initialized: boolean; completed: boolean } | null = null;
  const pending = new Map<number, string>();
  const uploaded = new Map<number, string>();
  let running: Promise<void> | null = null;
  let stopped = false;
  function run(): Promise<void> {
    if (running) return running;
    running = Promise.resolve().then(async () => {
      while (!stopped && work && pending.size) {
        const current = work;
        if (!current.initialized) {
          const result = await deps.create(current.id, current.spacing);
          if (work !== current) continue;
          current.initialized = true;
          current.completed = result.completed;
        }
        if (current.completed) { pending.clear(); break; }
        const [index, body] = pending.entries().next().value!;
        await deps.put(current.id, index, body);
        if (work !== current) continue;
        uploaded.set(index, body);
        if (pending.get(index) === body) pending.delete(index);
        deps.status(pending.size);
      }
    }).finally(() => { running = null; });
    void running.catch(deps.error);
    return running;
  }
  return {
    configure(id: string, spacing: string) {
      if (work?.id === id && work.spacing === spacing) return;
      work = { id, spacing, initialized: false, completed: false };
      pending.clear();
      uploaded.clear();
    },
    enqueue(index: number, body: string) {
      if (stopped) return;
      if (uploaded.get(index) === body && !pending.has(index)) return;
      pending.set(index, body);
      deps.status(pending.size);
      void run().catch(() => undefined); // Failure is reported; dirty entries remain for retry.
    },
    flush: run,
    stop() { stopped = true; pending.clear(); }
  };
}
