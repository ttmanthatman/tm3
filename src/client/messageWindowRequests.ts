// Message-window requests race each other: a slow first-page load can resolve
// after a newer one, and an A→B→A round trip makes the old view identity check
// pass again for a request that started before the user left. Identity alone
// cannot express "this request is stale", so every request carries a ticket
// binding it to the session/view epoch plus a per-kind sequence number, and
// only the current ticket may commit messages, loading flags, errors,
// pagination flags, or the window cache. Cancelling the HTTP request itself is
// left to the API layer's timeout; correctness here comes from the ticket.

export type MessageWindowRequestKind = "initial" | "older" | "newer" | "prefetch";

export interface MessageWindowRequestTicket {
  readonly epoch: number;
  readonly kind: MessageWindowRequestKind;
  readonly seq: number;
}

let epoch = 0;
const latestSeq: Record<MessageWindowRequestKind, number> = { initial: 0, older: 0, newer: 0, prefetch: 0 };

// View switches and account/session changes revoke every in-flight request.
export function invalidateMessageWindowRequests(): void {
  epoch += 1;
}

// A window-mutating commit (initial/older/newer page) moves the anchor that an
// in-flight prefetch of another kind was based on, so that prefetch is stale.
export function invalidateMessageWindowKind(kind: MessageWindowRequestKind): void {
  latestSeq[kind] += 1;
}

export function beginMessageWindowRequest(kind: MessageWindowRequestKind): MessageWindowRequestTicket {
  latestSeq[kind] += 1;
  return { epoch, kind, seq: latestSeq[kind] };
}

export function isMessageWindowRequestCurrent(ticket: MessageWindowRequestTicket): boolean {
  return ticket.epoch === epoch && ticket.seq === latestSeq[ticket.kind];
}
