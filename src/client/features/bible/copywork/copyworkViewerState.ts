import { ref } from "vue";
import type { CopyworkSource } from "@shared/bibleCopywork";
// The viewer outlives virtualized message rows and is cleared on account changes.
export const viewedCopyworkId = ref("");
export function openCopyworkViewer(id: string) {
  viewedCopyworkId.value = id;
}

let navigate: ((source: CopyworkSource) => Promise<void>) | null = null;
export function registerCopyworkNavigation(handler: (source: CopyworkSource) => Promise<void>) {
  navigate = handler;
  return () => { if (navigate === handler) navigate = null; };
}
export async function openCopyworkSource(source: CopyworkSource) {
  if (!navigate) throw new Error("圣经阅读器尚未就绪，请稍后重试");
  await navigate(source);
}
