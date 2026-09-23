type TimerHandle = unknown;

export type HandwritingDraftSchedulerOptions = {
  persist: () => void;
  delayMs?: number;
  schedule?: (callback: () => void, delayMs: number) => TimerHandle;
  cancel?: (timer: TimerHandle) => void;
};

export function createHandwritingDraftScheduler(options: HandwritingDraftSchedulerOptions) {
  const schedule = options.schedule || ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
  const cancel = options.cancel || ((timer: TimerHandle) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let timer: TimerHandle | null = null;

  function request() {
    if (timer !== null) return;
    timer = schedule(() => {
      timer = null;
      options.persist();
    }, options.delayMs ?? 300);
  }

  function flush() {
    if (timer !== null) cancel(timer);
    timer = null;
    options.persist();
  }

  function stop() {
    if (timer !== null) cancel(timer);
    timer = null;
  }

  return { request, flush, stop };
}
