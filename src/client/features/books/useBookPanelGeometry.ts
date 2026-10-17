import { onScopeDispose, ref, watch, type Ref } from "vue";

/** Toolbars and visualViewport own the available area; no guessed header height. */
export function useBookPanelGeometry(reader: Ref<HTMLElement | null>, toolbar: Ref<HTMLElement | null>) {
  const style = ref<Record<string, string>>({});
  const update = () => {
    if (!reader.value || !toolbar.value) return;
    const bounds = reader.value.getBoundingClientRect();
    const viewport = window.visualViewport;
    const bottom = Math.min(bounds.bottom, viewport ? viewport.offsetTop + viewport.height : window.innerHeight);
    const available = Math.max(0, bottom - bounds.top);
    const top = Math.max(0, Math.min(toolbar.value.getBoundingClientRect().bottom - bounds.top + 8, available - 60));
    style.value = { "--book-panel-top": `${top}px`, "--book-panel-height": `${Math.max(44, available - top - 12)}px` };
  };
  const observer = new ResizeObserver(update);
  const stop = watch([reader, toolbar], () => {
    observer.disconnect();
    if (reader.value) observer.observe(reader.value);
    if (toolbar.value) observer.observe(toolbar.value);
    update();
  }, { flush: "post" });
  window.addEventListener("resize", update);
  window.visualViewport?.addEventListener("resize", update);
  window.visualViewport?.addEventListener("scroll", update);
  onScopeDispose(() => {
    stop(); observer.disconnect(); window.removeEventListener("resize", update);
    window.visualViewport?.removeEventListener("resize", update);
    window.visualViewport?.removeEventListener("scroll", update);
  });
  return style;
}
