/** A server-assigned account number distinguishes guests with the same nickname. */
export function receptionGuestDisplayName(name: string, accountId: number) {
  const suffix = ` · 访客 #${accountId}`;
  const nickname = name.trim().replace(/(?:\s*·\s*访客\s*#\d+)+$/u, "").trim() || "来访者";
  const prefix = nickname.slice(0, 80 - suffix.length).replace(/[\uD800-\uDBFF]$/u, "").trimEnd();
  return prefix + suffix;
}
