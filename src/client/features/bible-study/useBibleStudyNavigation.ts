import { onScopeDispose, ref, watch, type Ref } from "vue";
import type { BibleLookupDTO } from "@shared/types";
import { api } from "../../api";
import type { BibleWorkspaceHandle } from "../bible/useBibleWorkspaceIntegration";

export interface StudyScriptureSelection {
  questionId: number;
  reference: string;
  evidence: string[];
  automatic: boolean;
}

/** Question selection controls reading; reader selection never changes the question. */
export function useBibleStudyNavigation(options: {
  enabled: () => boolean;
  workspace: Ref<Pick<BibleWorkspaceHandle, "openStudyContext" | "clearStudyContext"> | null>;
  splitAvailable: Ref<boolean>;
  bibleOpen: Ref<boolean>;
  bibleOnRight: Ref<boolean>;
  openBible: () => void;
  shrinkBible: () => void;
}) {
  const selection = ref<StudyScriptureSelection | null>(null);
  const error = ref("");
  let generation = 0;
  let openedReference = "";
  let wasActive = false;
  function select(value: StudyScriptureSelection) { selection.value = { ...value, evidence: [...value.evidence] }; }
  watch([selection, options.workspace, options.splitAvailable, options.enabled], async ([selected, workspace, desktop, enabled]) => {
    const current = ++generation;
    error.value = "";
    if (!enabled) {
      if (wasActive) workspace?.clearStudyContext();
      wasActive = false;
      openedReference = "";
      return;
    }
    wasActive = true;
    workspace?.clearStudyContext();
    if (!selected || !workspace || (selected.automatic && !desktop && !options.bibleOpen.value)) return;
    if (!options.bibleOpen.value) options.openBible();
    if (desktop) { options.bibleOnRight.value = false; options.shrinkBible(); }
    const references = [...new Set(selected.evidence)];
    // A whole-passage question clears the previous highlight without inventing a verse anchor.
    if (!references.length && openedReference === selected.reference) return;
    try {
      const lookups = await Promise.all((references.length ? references : [selected.reference]).map(async reference => {
        const response = await api<{ success: boolean; result?: BibleLookupDTO }>(`/api/bible/lookup?reference=${encodeURIComponent(reference)}`);
        if (!response.success || !response.result?.verses.length) throw new Error("相关经文暂时无法定位");
        return response.result;
      }));
      if (generation !== current || !options.enabled()) return;
      await workspace.openStudyContext(lookups, references.length > 0);
      if (generation === current) openedReference = selected.reference;
    } catch (reason) {
      if (generation === current) error.value = reason instanceof Error ? reason.message : "相关经文读取失败，请再点一次问题重试";
    }
  });
  onScopeDispose(() => { generation++; });
  return { selectStudyScripture: select, studyBibleError: error };
}
