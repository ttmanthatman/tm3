export interface UnconfirmedSend {
  clientRequestId: string;
  channelId: number;
  draft: string;
  payload: {
    channelId: number;
    content: string;
    type: string;
    payload?: unknown;
    replyToId: number | null;
    clientRequestId: string;
  };
}

export function unconfirmedSendsKey(accountId: number): string {
  return `team-chat-unconfirmed-sends:${accountId}`;
}

export function loadUnconfirmedSends(accountId: number): UnconfirmedSend[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(unconfirmedSendsKey(accountId)) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is UnconfirmedSend => {
      if (!value || typeof value !== "object") return false;
      const row = value as Partial<UnconfirmedSend>;
      return typeof row.clientRequestId === "string" && typeof row.channelId === "number" && typeof row.draft === "string" &&
        !!row.payload && row.payload.clientRequestId === row.clientRequestId && row.payload.channelId === row.channelId;
    });
  } catch {
    console.warn("Could not restore unconfirmed message sends");
    return [];
  }
}

export function saveUnconfirmedSends(accountId: number, rows: UnconfirmedSend[]): void {
  try {
    if (rows.length) localStorage.setItem(unconfirmedSendsKey(accountId), JSON.stringify(rows));
    else localStorage.removeItem(unconfirmedSendsKey(accountId));
  } catch {
    console.warn("Could not persist unconfirmed message sends");
  }
}
