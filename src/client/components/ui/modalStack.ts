// Shared stack for AppModal instances: one document keydown listener for every
// open modal, Escape/Tab handled only for the top-most entry, and focus moved
// into the dialog on open and returned to the trigger element on close.

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button",
  "input",
  "select",
  "textarea",
  "audio[controls]",
  "video[controls]",
  '[contenteditable="true"]',
  "[tabindex]"
].join(",");

export interface ModalStackEntry {
  root: () => HTMLElement | null;
  canClose: () => boolean;
  requestClose: () => void;
}

export interface ModalRegistration {
  release: () => void;
}

interface TrackedEntry extends ModalStackEntry {
  restoreFocusTo: Element | null;
  released: boolean;
}

function asFocusable(element: Element): HTMLElement | null {
  const candidate = element as HTMLElement;
  if (typeof candidate.focus !== "function") return null;
  if (typeof candidate.hasAttribute === "function" && candidate.hasAttribute("disabled")) return null;
  if (candidate.getAttribute("tabindex") === "-1") return null;
  if (typeof candidate.getClientRects === "function" && candidate.getClientRects().length === 0) return null;
  return candidate;
}

export function createModalStack(doc: Document) {
  const entries: TrackedEntry[] = [];

  function top(): TrackedEntry | undefined {
    return entries[entries.length - 1];
  }

  function collectFocusables(root: HTMLElement): HTMLElement[] {
    const result: HTMLElement[] = [];
    for (const element of Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR))) {
      const focusable = asFocusable(element);
      if (focusable) result.push(focusable);
    }
    return result;
  }

  function focusFirst(entry: TrackedEntry) {
    const root = entry.root();
    if (!root) return;
    const focusables = collectFocusables(root);
    const target = focusables[0] ?? root;
    if (target === root && root.getAttribute("tabindex") !== "-1") root.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  }

  function handleKeydown(event: KeyboardEvent) {
    const current = top();
    if (!current) return;
    if (event.key === "Escape") {
      // IME composition: Escape belongs to the input method, not the modal.
      if (event.isComposing) return;
      // A busy modal keeps the historical semantics: Escape falls through.
      if (!current.canClose()) return;
      event.preventDefault();
      event.stopPropagation();
      current.requestClose();
      return;
    }
    if (event.key !== "Tab") return;
    const root = current.root();
    if (!root) {
      event.preventDefault();
      return;
    }
    const focusables = collectFocusables(root);
    if (!focusables.length) {
      event.preventDefault();
      focusFirst(current);
      return;
    }
    const active = doc.activeElement as HTMLElement | null;
    const index = active && root.contains(active) ? focusables.indexOf(active) : -1;
    if (event.shiftKey) {
      if (index <= 0) {
        event.preventDefault();
        focusables[focusables.length - 1].focus({ preventScroll: true });
      }
      return;
    }
    if (index === -1 || index === focusables.length - 1) {
      event.preventDefault();
      focusables[0].focus({ preventScroll: true });
    }
  }

  function register(entry: ModalStackEntry): ModalRegistration {
    if (!entries.length) doc.addEventListener("keydown", handleKeydown, true);
    const tracked: TrackedEntry = { ...entry, restoreFocusTo: doc.activeElement, released: false };
    entries.push(tracked);
    focusFirst(tracked);
    return {
      release() {
        if (tracked.released) return;
        tracked.released = true;
        const wasTop = top() === tracked;
        const index = entries.indexOf(tracked);
        if (index >= 0) entries.splice(index, 1);
        if (!entries.length) doc.removeEventListener("keydown", handleKeydown, true);
        if (!wasTop) return;
        const restore = tracked.restoreFocusTo as HTMLElement | null;
        if (restore && restore.isConnected && typeof restore.focus === "function") {
          restore.focus({ preventScroll: true });
          return;
        }
        const next = top();
        if (next) focusFirst(next);
      }
    };
  }

  return {
    register,
    size: () => entries.length
  };
}

let shared: ReturnType<typeof createModalStack> | null = null;

export function sharedModalStack() {
  if (!shared) shared = createModalStack(document);
  return shared;
}
