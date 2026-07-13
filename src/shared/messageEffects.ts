import type { MessageEffect } from "./types.js";

export const SUPPORTED_MESSAGE_EFFECTS = ["flash", "shine", "shake", "fly", "drip", "rain", "oops"] as const satisfies readonly MessageEffect[];

const supportedMessageEffects = new Set<string>(SUPPORTED_MESSAGE_EFFECTS);

export function cleanSupportedMessageEffect(value: unknown): MessageEffect | undefined {
  return typeof value === "string" && supportedMessageEffects.has(value) ? (value as MessageEffect) : undefined;
}
