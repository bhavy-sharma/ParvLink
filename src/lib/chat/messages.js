// Pure helpers for the chat screen: keeping the message list ordered and free
// of duplicates, whatever order the pieces arrive in (first page, older pages,
// live catch-ups, the reply to a send).
//
// A message is { seq, body, created_at, mine, client_id }. `seq` is its
// position inside the conversation, assigned by the database.

/** Merges `incoming` into `existing`: one entry per seq, ascending. Returns `existing` itself if nothing changed. */
export function mergeMessages(existing, incoming) {
  if (!incoming || incoming.length === 0) return existing;
  const bySeq = new Map(existing.map((message) => [message.seq, message]));
  let changed = false;
  for (const message of incoming) {
    if (!message || !Number.isInteger(message.seq)) continue;
    if (!bySeq.has(message.seq)) {
      bySeq.set(message.seq, message);
      changed = true;
    }
  }
  if (!changed) return existing;
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** The highest seq held (0 when there are no messages) — the cursor for "anything newer?". */
export function latestSeq(messages) {
  return messages.length === 0 ? 0 : messages[messages.length - 1].seq;
}

/** The lowest seq held (null when there are no messages) — the cursor for "load earlier". */
export function earliestSeq(messages) {
  return messages.length === 0 ? null : messages[0].seq;
}

/** Drops unsent drafts that the server has since confirmed (matched by client id). */
export function withoutConfirmed(pending, messages) {
  if (pending.length === 0) return pending;
  const confirmed = new Set(messages.filter((message) => message.client_id).map((message) => message.client_id));
  const remaining = pending.filter((draft) => !confirmed.has(draft.clientId));
  return remaining.length === pending.length ? pending : remaining;
}

/**
 * Splits a page fetched with one extra row into { messages, hasEarlier }.
 * The database returns pages oldest → newest, so the extra row is the first.
 */
export function splitPage(rows, pageSize) {
  if (rows.length > pageSize) return { messages: rows.slice(rows.length - pageSize), hasEarlier: true };
  return { messages: rows, hasEarlier: false };
}

/** A random id for a message being composed (v4 UUID), also where crypto.randomUUID is unavailable (plain-http dev hosts). */
export function newClientId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
