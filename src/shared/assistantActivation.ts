/** A typed space at the visible end of a message opts out of assistant processing.
 * HTML editors encode that space as NBSP and may wrap it in closing tags.
 * A real trailing line break remains a line break, rather than a space.
 */
export function hasAssistantOptOutSuffix(content: unknown): boolean {
  if (typeof content !== "string") return false;
  const visible = content
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:nbsp|#0*160|#x0*a0);/gi, "\u00a0");
  return /[ \u00a0]$/.test(visible);
}

/** This payload field is written only after the server inspects raw input. */
export function assistantActivationSuppressed(message: { content?: string | null; payload?: unknown }): boolean {
  const payload = message.payload;
  return hasAssistantOptOutSuffix(message.content) || !!(
    payload && typeof payload === "object" && !Array.isArray(payload) &&
    (payload as Record<string, unknown>).aiActivationSuppressed === true
  );
}

/** Apply after normal payload validation, before text trimming or rewriting is lost.
 * Never accept a client-provided value for the reserved policy field.
 */
export function assistantActivationPayload(rawContent: unknown, validatedPayload?: unknown): Record<string, unknown> | undefined {
  const payload: Record<string, unknown> = validatedPayload && typeof validatedPayload === "object" && !Array.isArray(validatedPayload)
    ? { ...validatedPayload } : {};
  delete payload.aiActivationSuppressed;
  if (hasAssistantOptOutSuffix(rawContent)) payload.aiActivationSuppressed = true;
  return Object.keys(payload).length ? payload : undefined;
}
