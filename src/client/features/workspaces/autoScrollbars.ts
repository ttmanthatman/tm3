/** Reveal the scrollbar for wheel, touch and programmatic scrolling alike. */
export function installAutoScrollbars() {
  const timers = new Map<Element, ReturnType<typeof setTimeout>>();
  function clear() {
    for (const [element, timer] of timers) {
      clearTimeout(timer);
      element.removeAttribute("data-scroll-active");
    }
    timers.clear();
  }
  function scroll(event: Event) {
    const element = event.target === document ? document.documentElement : event.target;
    if (!(element instanceof Element)) return;
    clearTimeout(timers.get(element));
    element.setAttribute("data-scroll-active", "");
    timers.set(element, setTimeout(() => {
      element.removeAttribute("data-scroll-active");
      timers.delete(element);
    }, 900));
  }
  function visibility() { if (document.hidden) clear(); }
  document.addEventListener("scroll", scroll, { capture: true, passive: true });
  document.addEventListener("visibilitychange", visibility);
  return () => {
    document.removeEventListener("scroll", scroll, true);
    document.removeEventListener("visibilitychange", visibility);
    clear();
  };
}
