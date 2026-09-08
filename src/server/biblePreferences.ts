import { Prisma } from "@prisma/client";
import type { BiblePreferencesDTO } from "../shared/types.js";
import { cleanBibleWorkspaceState } from "./bible/workspaceState.js";

const BIBLE_OUTPUT_FORMATS = new Set(["referenceVerseLines", "continuousText", "referenceHeader", "numberedVerses"]);
const BIBLE_REFERENCE_LABEL_MODES = new Set(["normalizedFull", "preserveInput", "omit"]);
const BIBLE_COMBINED_PASSAGE_MODES = new Set(["compactEllipsis", "groupedLines"]);
const BIBLE_QUOTATION_STYLES = new Set(["fullWidth", "halfWidth", "square"]);
const DEFAULT_BIBLE_PREFERENCES: BiblePreferencesDTO = {
  outputFormat: "continuousText",
  referenceLabelMode: "normalizedFull",
  combinedPassageMode: "compactEllipsis",
  quotationStyle: "fullWidth"
};

export function cleanBiblePreferences(value: unknown): BiblePreferencesDTO {
  const row = value && typeof value === "object" ? (value as Partial<BiblePreferencesDTO>) : {};
  const workspace = row.workspace ? cleanBibleWorkspaceState(row.workspace) : null;
  return {
    outputFormat: BIBLE_OUTPUT_FORMATS.has(String(row.outputFormat)) ? (row.outputFormat as BiblePreferencesDTO["outputFormat"]) : DEFAULT_BIBLE_PREFERENCES.outputFormat,
    referenceLabelMode: BIBLE_REFERENCE_LABEL_MODES.has(String(row.referenceLabelMode)) ? (row.referenceLabelMode as BiblePreferencesDTO["referenceLabelMode"]) : DEFAULT_BIBLE_PREFERENCES.referenceLabelMode,
    combinedPassageMode: BIBLE_COMBINED_PASSAGE_MODES.has(String(row.combinedPassageMode)) ? (row.combinedPassageMode as BiblePreferencesDTO["combinedPassageMode"]) : DEFAULT_BIBLE_PREFERENCES.combinedPassageMode,
    quotationStyle: BIBLE_QUOTATION_STYLES.has(String(row.quotationStyle)) ? (row.quotationStyle as BiblePreferencesDTO["quotationStyle"]) : DEFAULT_BIBLE_PREFERENCES.quotationStyle,
    ...(workspace ? { workspace } : {})
  };
}

export function biblePreferencesJson(value: unknown): Prisma.InputJsonObject {
  const preferences = cleanBiblePreferences(value);
  return {
    outputFormat: preferences.outputFormat,
    referenceLabelMode: preferences.referenceLabelMode,
    combinedPassageMode: preferences.combinedPassageMode,
    quotationStyle: preferences.quotationStyle,
    ...(preferences.workspace ? { workspace: preferences.workspace as unknown as Prisma.InputJsonValue } : {})
  };
}
