import type { MessageDTO } from "@shared/types";

/** Keep each announcement's lively palette fixed across reactive re-renders. */
export function storyAnnouncementLetters(message: MessageDTO): { text: string; color: string }[] | null {
  if (message.type !== "system" || !message.payload || typeof message.payload !== "object" ||
      !("kind" in message.payload) || message.payload.kind !== "story_announcement") return null;

  const seed = (Math.imul(message.id, 2654435761) >>> 0) % 360;
  return Array.from(message.content).map((text, index) => {
    const hue = (seed + index * 137.508) % 360;
    // Yellow/lime need a deeper shade to remain legible on the warm highlight.
    const lightness = hue >= 38 && hue <= 155 ? 33 : 45;
    return { text, color: `hsl(${hue.toFixed(2)} 86% ${lightness}%)` };
  });
}
