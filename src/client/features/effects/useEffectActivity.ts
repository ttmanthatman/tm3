import { computed, getCurrentInstance, onMounted, onScopeDispose, ref, watch } from "vue";

/** Shared lifecycle for decorative effects, including bfcache and live OS preferences. */
export function useEffectActivity(options: {
  enabled?: () => boolean;
  onChange?: (active: boolean) => void;
} = {}) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  const reducedMotion = ref(media.matches);
  const documentVisible = ref(!document.hidden);
  const pageActive = ref(true);
  const active = computed(() => documentVisible.value && pageActive.value && !reducedMotion.value && (options.enabled?.() ?? true));
  const updateMotion = () => { reducedMotion.value = media.matches; };
  const updateVisibility = () => { documentVisible.value = !document.hidden; };
  const hide = () => { pageActive.value = false; };
  const show = () => { pageActive.value = true; updateVisibility(); };
  const stopWatch = watch(active, (value) => options.onChange?.(value), { flush: "sync" });
  media.addEventListener("change", updateMotion);
  document.addEventListener("visibilitychange", updateVisibility);
  window.addEventListener("pagehide", hide);
  window.addEventListener("pageshow", show);
  if (getCurrentInstance()) onMounted(() => options.onChange?.(active.value));
  onScopeDispose(() => {
    stopWatch();
    media.removeEventListener("change", updateMotion);
    document.removeEventListener("visibilitychange", updateVisibility);
    window.removeEventListener("pagehide", hide);
    window.removeEventListener("pageshow", show);
    options.onChange?.(false);
  });
  return { active };
}
