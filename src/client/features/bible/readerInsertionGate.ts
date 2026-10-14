// Changing scrollTop while a finger is down can reset WebKit's native scroll
// origin. Wait for both contact release and a quiet momentum interval before
// inserting content above the reader. Generation resets release stale waits.
export function createReaderInsertionGate(quietMs = 180) {
  let touching = false;
  let lastMotion = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Set<(ready: boolean) => void>();
  const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const pump = () => {
    clearTimer();
    if (!pending.size || touching) return;
    const delay = quietMs - (Date.now() - lastMotion);
    if (delay > 0) { timer = setTimeout(pump, delay); return; }
    const waits = [...pending];
    pending.clear();
    for (const resolve of waits) resolve(true);
  };
  return {
    touchStart() { touching = true; clearTimer(); },
    touchEnd() { touching = false; lastMotion = Date.now(); pump(); },
    motion() { lastMotion = Date.now(); pump(); },
    wait() { return new Promise<boolean>((resolve) => { pending.add(resolve); pump(); }); },
    cancel() {
      clearTimer();
      const waits = [...pending];
      pending.clear();
      for (const resolve of waits) resolve(false);
    }
  };
}
