import { watch, type Ref } from "vue";
import { composerHeightForContent } from "../../composerLayout";

const measurementProperties = [
  "box-sizing", "font", "letter-spacing", "word-spacing", "text-indent",
  "text-transform", "text-align", "direction", "tab-size", "white-space",
  "word-break", "overflow-wrap", "padding-top", "padding-bottom",
  "padding-left", "padding-right", "border-top-width", "border-bottom-width",
  "border-left-width", "border-right-width", "border-style"
];

/** Measure outside the chat layout: collapsing the live textarea for each
 * keystroke temporarily expands the timeline and disturbs scroll anchoring. */
export function useComposerAutosize(textarea: Readonly<Ref<HTMLTextAreaElement | null>>, value: Readonly<Ref<string>>) {
  watch(textarea, (element, _previous, onCleanup) => {
    if (!element) return;
    const document = element.ownerDocument;
    const view = document.defaultView!;
    const mirror = document.createElement("textarea");
    mirror.setAttribute("aria-hidden", "true");
    mirror.tabIndex = -1;
    mirror.readOnly = true;
    mirror.style.cssText = "position:fixed;left:-10000px;top:0;height:0;min-height:0;max-height:none;overflow:hidden;visibility:hidden;pointer-events:none;margin:0;";
    document.body.append(mirror);
    let measuredWidth = -1;
    let resizeFrame: number | undefined;

    function resize() {
      if (!element) return;
      const width = element.getBoundingClientRect().width;
      if (!width) return;
      measuredWidth = width;
      const style = view.getComputedStyle(element);
      for (const property of measurementProperties) mirror.style.setProperty(property, style.getPropertyValue(property));
      mirror.style.width = `${width}px`;
      mirror.wrap = element.wrap;
      mirror.value = element.value;
      const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      const contentHeight = mirror.scrollHeight + borders;
      const height = composerHeightForContent(contentHeight);
      const heightStyle = `${height}px`;
      const overflow = contentHeight > height ? "auto" : "hidden";
      if (element.style.height !== heightStyle) element.style.height = heightStyle;
      if (element.style.overflowY !== overflow) element.style.overflowY = overflow;
    }

    const stopValueWatch = watch(value, resize, { flush: "post", immediate: true });
    const observer = new ResizeObserver(() => {
      if (element.getBoundingClientRect().width === measuredWidth || resizeFrame !== undefined) return;
      // A height write inside delivery would trigger another observer pass.
      resizeFrame = view.requestAnimationFrame(() => {
        resizeFrame = undefined;
        resize();
      });
    });
    observer.observe(element);
    onCleanup(() => {
      stopValueWatch();
      observer.disconnect();
      if (resizeFrame !== undefined) view.cancelAnimationFrame(resizeFrame);
      mirror.remove();
    });
  }, { flush: "post", immediate: true });
}
