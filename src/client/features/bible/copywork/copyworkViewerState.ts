import { ref } from "vue";
// The viewer outlives virtualized message rows and is cleared on account changes.
export const viewedCopyworkId = ref("");
export function openCopyworkViewer(id: string) {
  viewedCopyworkId.value = id;
}
