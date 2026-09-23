import { Prisma } from "@prisma/client";
import {
  normalizeHandwritingPreferences,
  type HandwritingPreferencesDTO
} from "../shared/handwriting.js";

export function cleanHandwritingPreferences(value: unknown): HandwritingPreferencesDTO {
  return normalizeHandwritingPreferences(value);
}

export function handwritingPreferencesJson(value: unknown): Prisma.InputJsonObject {
  return cleanHandwritingPreferences(value) as unknown as Prisma.InputJsonObject;
}
