export function copyworkTapRegion(x: number, width: number, paging: boolean) {
  const edge = Math.min(32, Math.max(20, width * 0.07));
  if (paging && x <= edge) return "previous";
  if (paging && x >= width - edge) return "next";
  return "playback";
}

type Contact = { id: number; x: number; y: number; width: number };
type Dependencies = {
  paging: () => boolean;
  playing: () => boolean;
  progress: () => number;
  duration: () => number;
  toggle: () => void;
  restart: () => void;
  pause: () => void;
  resume: () => void;
  seek: (progress: number) => void;
  turn: (direction: -1 | 1) => void;
  now?: () => number;
  schedule?: (callback: () => void) => ReturnType<typeof setTimeout>;
  unschedule?: (timer: ReturnType<typeof setTimeout>) => void;
};

export function createCopyworkGestures(deps: Dependencies) {
  const now = deps.now || (() => performance.now());
  const schedule = deps.schedule || ((callback) => setTimeout(callback, 280));
  const unschedule = deps.unschedule || clearTimeout;
  let contact:
    | (Contact & { progress: number; resume: boolean; dragging: boolean; scrolling: boolean })
    | null = null;
  let tap: { at: number; x: number; y: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTap() {
    if (timer !== null) unschedule(timer);
    timer = null;
    tap = null;
  }
  function cancel() {
    clearTap();
    contact = null;
  }
  function lostCapture() {
    if (contact) cancel();
  }
  function down(point: Contact) {
    if (contact) {
      cancel();
      return;
    }
    contact = {
      ...point,
      progress: deps.progress(),
      resume: deps.playing(),
      dragging: false,
      scrolling: false
    };
  }
  function move(point: Contact) {
    if (!contact || point.id !== contact.id || contact.scrolling) return false;
    const dx = point.x - contact.x;
    const dy = point.y - contact.y;
    if (!contact.dragging) {
      if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) {
        contact.scrolling = true;
        clearTap();
        return false;
      }
      if (Math.abs(dx) <= 8 || Math.abs(dx) <= Math.abs(dy)) return false;
      contact.dragging = true;
      clearTap();
      deps.pause();
    }
    deps.seek(contact.progress + (dx / Math.max(1, contact.width)) * deps.duration());
    return true;
  }
  function up(point: Contact) {
    if (!contact || point.id !== contact.id) return;
    const current = contact;
    contact = null;
    if (current.dragging) {
      if (current.resume) deps.resume();
      return;
    }
    if (current.scrolling) return;
    const region = copyworkTapRegion(point.x, point.width, deps.paging());
    if (region !== "playback") {
      clearTap();
      deps.turn(region === "previous" ? -1 : 1);
      return;
    }
    const at = now();
    if (tap && at - tap.at < 280 && Math.hypot(point.x - tap.x, point.y - tap.y) < 24) {
      clearTap();
      deps.restart();
    } else {
      if (tap) {
        clearTap();
        deps.toggle();
      }
      tap = { at, x: point.x, y: point.y };
      timer = schedule(() => {
        clearTap();
        deps.toggle();
      });
    }
  }
  return { down, move, up, cancel, lostCapture };
}
