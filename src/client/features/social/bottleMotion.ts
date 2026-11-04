import { readonly, ref } from "vue";

type PermissionConstructor = { requestPermission?: () => Promise<string> };
type MotionStatus = "idle" | "waiting" | "enabled" | "denied" | "unsupported" | "disabled" | "error";
const enabled = ref(false);
const busy = ref(false);
const status = ref<MotionStatus>("idle");
let automaticAllowed = true;
let automaticAttempted = false;

async function request(automatic = false, userGesture = false) {
  if (enabled.value || busy.value || (automatic && (!automaticAllowed || automaticAttempted))) return;
  if (!window.isSecureContext || !("DeviceMotionEvent" in window)) { status.value = "unsupported"; return; }
  const constructors: PermissionConstructor[] = [window.DeviceMotionEvent as unknown as PermissionConstructor, window.DeviceOrientationEvent as unknown as PermissionConstructor];
  // iOS requires an active user gesture. Queue automatic requests until the next
  // real interaction rather than spending that permission attempt during loading.
  if (automatic && constructors.some((ctor) => ctor?.requestPermission) && !userGesture && !navigator.userActivation?.isActive) {
    status.value = "waiting";
    return;
  }
  automaticAllowed = true;
  automaticAttempted = true;
  busy.value = true;
  try {
    const permissions = await Promise.all(constructors.map((ctor) => ctor?.requestPermission ? ctor.requestPermission() : Promise.resolve("granted")));
    enabled.value = permissions.every((permission) => permission === "granted");
    status.value = enabled.value ? "enabled" : "denied";
  } catch { enabled.value = false; status.value = "error"; }
  finally { busy.value = false; }
}
function disable() {
  automaticAllowed = false;
  enabled.value = false;
  status.value = "disabled";
}
export const bottleMotion = { enabled: readonly(enabled), busy: readonly(busy), status: readonly(status), request, disable };
