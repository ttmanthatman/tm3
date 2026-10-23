import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { meetingIsActive, type ZoomSettings } from "@shared/zoom";
import { api } from "../../api";
import { useHeaderVisibility } from "../listen/useHeaderVisibility";

const changedEvent = "zoom-settings-changed";

export function useZoomMeeting() {
  const settings = ref<ZoomSettings>({ url: "", meeting: null });
  const ready = ref(false);
  const error = ref("");
  const now = ref(Date.now());
  const visible = useHeaderVisibility();
  const active = computed(() => meetingIsActive(settings.value.meeting, now.value));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | null = null;
  let disposed = false;

  function stop() {
    clearTimeout(timer);
    controller?.abort();
    controller = null;
  }
  function schedule() {
    clearTimeout(timer);
    if (disposed || !visible.value) return;
    const remaining = settings.value.meeting ? Date.parse(settings.value.meeting.endsAt) - Date.now() : 0;
    timer = setTimeout(() => void refresh(), remaining > 0 ? Math.min(15_000, remaining) : 15_000);
  }
  async function refresh() {
    stop();
    now.value = Date.now();
    if (disposed || !visible.value) return;
    const request = new AbortController();
    controller = request;
    try {
      const value = await api<ZoomSettings>("/api/zoom", { signal: request.signal });
      if (disposed || request.signal.aborted) return;
      settings.value = value;
      ready.value = true;
      error.value = "";
    } catch (reason) {
      if (request.signal.aborted) return;
      error.value = reason instanceof Error ? reason.message : "会议状态加载失败";
    } finally {
      if (controller === request) { controller = null; schedule(); }
    }
  }
  async function save(part: "link" | "meeting", body: unknown) {
    const value = await api<ZoomSettings>(`/api/admin/zoom/${part}`, { method: "PUT", body: JSON.stringify(body) });
    stop();
    settings.value = value;
    ready.value = true;
    error.value = "";
    now.value = Date.now();
    schedule();
    window.dispatchEvent(new Event(changedEvent));
  }
  const onChanged = () => { void refresh(); };
  watch(visible, value => { if (value) void refresh(); else stop(); });
  onMounted(() => window.addEventListener(changedEvent, onChanged));
  onBeforeUnmount(() => {
    disposed = true;
    stop();
    window.removeEventListener(changedEvent, onChanged);
  });
  return { settings, active, ready, error, visible, refresh, save };
}
