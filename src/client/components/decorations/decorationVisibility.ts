/** Observe the stable host, not the glowing pixels that extend outside it. */
export function observeDecorationVisibility(host: Element, update: (visible: boolean) => void) {
  let intersecting = false;
  let pageActive = true;
  const sync = () => update(intersecting && pageActive && document.visibilityState === "visible");
  const hide = () => { pageActive = false; sync(); };
  const show = () => { pageActive = true; sync(); };
  const observer = new IntersectionObserver(([entry]) => {
    intersecting = entry.isIntersecting;
    sync();
  });
  observer.observe(host);
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("pagehide", hide);
  window.addEventListener("pageshow", show);
  sync();
  return () => {
    observer.disconnect();
    document.removeEventListener("visibilitychange", sync);
    window.removeEventListener("pagehide", hide);
    window.removeEventListener("pageshow", show);
    update(false);
  };
}
