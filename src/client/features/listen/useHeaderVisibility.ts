import { onBeforeUnmount, onMounted, ref } from "vue";

/** The fixed header is visible only while its document is in the foreground. */
export function useHeaderVisibility() {
  const visible = ref(false);
  const update = () => { visible.value = document.visibilityState === "visible"; };
  const hide = () => { visible.value = false; };
  onMounted(() => {
    update();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", update);
  });
  onBeforeUnmount(() => {
    hide();
    document.removeEventListener("visibilitychange", update);
    window.removeEventListener("pagehide", hide);
    window.removeEventListener("pageshow", update);
  });
  return visible;
}
