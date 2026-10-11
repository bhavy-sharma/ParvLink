import "server-only";

// Reads for the chat pages. Each is a service that answers only about the
// signed-in caller; see src/lib/services/chat.js.

import { splitPage } from "@/lib/chat/messages";
import { formatDate, formatTime } from "@/lib/dates";
import { call } from "@/lib/services";
import { CHAT_PAGE_SIZE } from "@/lib/validation/limits";

// Labels are made here, on the server, for every message — first page, older
// pages and live updates alike — so one conversation never shows two styles
// of time (browsers format "6:10 pm" differently from the server).
const labelled = (rows) => rows.map((row) => ({ ...row, time_label: formatTime(row.created_at), day_label: formatDate(row.created_at) }));
export const labelMessage = (row) => labelled([row])[0];

/** The caller's conversations (optionally those of one event), most recent activity first. */
export async function listMyConversations(eventId = null) {
  const { data, error } = await call("list_my_conversations", eventId ? { p_event_id: eventId } : {});
  return { error, conversations: error ? [] : (data ?? []) };
}

/** Header data for one conversation, or null if the caller is not one of its two students. */
export async function openConversation(conversation) {
  const { data, error } = await call("chat_open", { p_conversation: conversation });
  if (error || !data) return null;
  return data;
}

/**
 * One bounded page of a conversation, oldest → newest.
 *   { after }  → everything newer than that seq (catch-up)
 *   { before } → the page just before that seq ("load earlier")
 *   {}         → the latest page
 */
export async function fetchMessages(conversation, { before = null, after = null } = {}) {
  if (after != null) {
    const { data, error } = await call("chat_messages", { p_conversation: conversation, p_after: after, p_limit: 100 });
    return { error, messages: error ? [] : labelled(data ?? []), hasEarlier: null };
  }
  // One extra row tells us whether an earlier page exists.
  const { data, error } = await call("chat_messages", { p_conversation: conversation, p_before: before, p_limit: CHAT_PAGE_SIZE + 1 });
  if (error) return { error, messages: [], hasEarlier: false };
  return { error: null, ...splitPage(labelled(data ?? []), CHAT_PAGE_SIZE) };
}
