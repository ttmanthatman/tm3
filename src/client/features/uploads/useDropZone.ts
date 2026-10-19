import { ref } from "vue";
import { dataTransferHasFiles, filesFromDataTransfer } from "./fileIntake";

type DropZoneOptions = {
  onFiles: (files: File[]) => void;
  // Drag feedback stays hidden and drops are ignored while disabled (e.g. the
  // story workspace covering the chat pane).
  enabled?: () => boolean;
};

// Drag depth counting keeps the mask stable while the cursor crosses child
// elements; dragleave may arrive without a dataTransfer, so it always decrements.
export function useDropZone(options: DropZoneOptions) {
  const active = ref(false);
  let depth = 0;

  function reset() {
    depth = 0;
    active.value = false;
  }

  function dragenter(event: DragEvent) {
    if (options.enabled && !options.enabled()) return;
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    depth += 1;
    active.value = true;
  }

  function dragover(event: DragEvent) {
    if (options.enabled && !options.enabled()) return;
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    active.value = true;
  }

  function dragleave() {
    depth = Math.max(0, depth - 1);
    if (depth === 0) active.value = false;
  }

  function drop(event: DragEvent) {
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    reset();
    if (options.enabled && !options.enabled()) return;
    options.onFiles(filesFromDataTransfer(event.dataTransfer));
  }

  return { active, dragenter, dragover, dragleave, drop, reset };
}
