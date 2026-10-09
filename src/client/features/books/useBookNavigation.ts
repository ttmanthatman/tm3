import { onMounted, onScopeDispose, ref, watch } from "vue";
import { parseBookReadingUrl, type BookLocation } from "./bookReading";

export function useBookNavigation(accountId: () => number | undefined, open: () => void) {
  const location = ref<BookLocation | null>(null);
  function navigate(next: BookLocation) { location.value = next; open(); }
  function consumeUrl() {
    if (!accountId()) return;
    const next = parseBookReadingUrl(window.location.href, window.location.origin);
    if (!next) return;
    navigate(next);
    const url = new URL(window.location.href);
    url.searchParams.delete("bookId"); url.searchParams.delete("bookFraction");
    window.history.replaceState(window.history.state, "", url);
  }
  function click(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !accountId()) return;
    const anchor = (event.target as Element | null)?.closest?.("a[href]");
    const next = anchor ? parseBookReadingUrl(anchor.getAttribute("href") || "", window.location.origin) : null;
    if (!next) return;
    event.preventDefault(); event.stopPropagation(); navigate(next);
  }
  watch(accountId, (value, previous) => { if (value !== previous) location.value = null; consumeUrl(); }, { flush: "post" });
  onMounted(() => { consumeUrl(); document.addEventListener("click", click, true); });
  onScopeDispose(() => document.removeEventListener("click", click, true));
  return { bookLocation: location };
}
