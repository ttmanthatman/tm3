type RenderKey = object;
type RenderQueueOptions = {
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
  now?: () => number;
  budgetMs?: number;
};

// All message canvases share a frame budget so entering a channel cannot run
// every visible message's static drawing in one uninterrupted browser task.
export function createHandwritingRenderQueue(options: RenderQueueOptions = {}) {
  const requestFrame = options.requestFrame || ((callback) => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame || ((handle) => cancelAnimationFrame(handle));
  const now = options.now || (() => performance.now());
  const budgetMs = options.budgetMs ?? 8;
  const pending = new Map<RenderKey, () => void>();
  let frame = 0;
  let flushing = false;

  function schedule() {
    if (!flushing && !frame && pending.size) frame = requestFrame(flush);
  }

  function flush() {
    frame = 0;
    flushing = true;
    const start = now();
    let count = 0;
    try {
      while (pending.size && count < 32 && (count === 0 || now() - start < budgetMs)) {
        const [key, draw] = pending.entries().next().value!;
        pending.delete(key);
        draw();
        count++;
      }
    } finally {
      flushing = false;
      schedule();
    }
  }

  return {
    enqueue(key: RenderKey, draw: () => void) {
      pending.set(key, draw);
      schedule();
    },
    cancel(key: RenderKey) {
      pending.delete(key);
      if (!pending.size && frame) {
        cancelFrame(frame);
        frame = 0;
      }
    }
  };
}

export const handwritingRenderQueue = createHandwritingRenderQueue();
