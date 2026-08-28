import type { SermonDisplayDTO } from "@shared/types";

export type SermonBackgroundPreset = {
  value: string;
  label: string;
  chip: string;
  textColor: string;
};

export const SERMON_BG_PRESETS: SermonBackgroundPreset[] = [
  { value: "gradient", label: "暮夜", chip: "linear-gradient(145deg, #09101f, #242447 56%, #43294b)", textColor: "#f8f4e8" },
  { value: "aurora", label: "极光", chip: "linear-gradient(145deg, #062f3d, #124e66 48%, #33275d)", textColor: "#f2fbff" },
  { value: "sunset", label: "晚霞", chip: "linear-gradient(145deg, #4a1737, #9a3f55 52%, #e47a5f)", textColor: "#fff7ed" },
  { value: "forest", label: "松林", chip: "linear-gradient(145deg, #071f1c, #17463c 52%, #315e4e)", textColor: "#f1f8e9" },
  { value: "dawn", label: "晨光", chip: "linear-gradient(145deg, #f9e9d2, #f3c9bd 52%, #c9d7ee)", textColor: "#26334a" },
  { value: "dark", label: "深蓝", chip: "#0f172a", textColor: "#f8fafc" },
  { value: "light", label: "宣纸", chip: "#fafaf7", textColor: "#1f2937" },
  { value: "sepia", label: "米色", chip: "#f3ead7", textColor: "#3f3222" },
  { value: "midnight", label: "纯黑", chip: "#000000", textColor: "#e5e7eb" }
];

export const SERMON_TEXT_COLORS = ["#f8f4e8", "#f2fbff", "#f8fafc", "#f7df9b", "#26334a", "#1f2937"];

export function sermonThemePatch(preset: SermonBackgroundPreset): Pick<SermonDisplayDTO, "background" | "textColor"> {
  return { background: preset.value, textColor: preset.textColor };
}

export function pairedSermonTextColor(background: string): string {
  return SERMON_BG_PRESETS.find((preset) => preset.value === background)?.textColor ?? "#f8f4e8";
}
