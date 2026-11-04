import { z } from "zod";

export const pollSchema = z.object({
  kind: z.literal("poll"),
  question: z.string().trim().min(1).max(200),
  options: z.array(z.string().trim().min(1).max(100)).min(2).max(12)
}).strict().refine((poll) => new Set(poll.options).size === poll.options.length, "选项不能重复");
export type Poll = z.infer<typeof pollSchema>;
export function pollPayload(value: unknown): Poll | null {
  const result = pollSchema.safeParse(value);
  return result.success ? result.data : null;
}
export type PollResults = { counts: number[]; total: number; selected: number | null };
export type Bottle = { id: string; style: number };
export const bottleTextSchema = z.string().trim().min(1).max(2000);
