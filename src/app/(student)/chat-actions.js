"use server";

// Chat actions. Each one:
//   1. requires a signed-in student with a profile;
//   2. validates its input — a conversation id and, for a send, the text and a
//      client-chosen id for that one message. No user id is ever accepted;
//   3. calls one database function, which takes the caller from the session
//      and decides by itself whether this caller may read or write there.
//
// Message text is never logged and never placed in a URL or an error message.

import { revalidatePath } from "next/cache";
import { describeDbError, logServerError } from "@/lib/auth/errors";
import { requireProfile, requireProfileOrSignedOut } from "@/lib/auth/session";
import { fetchMessages, labelMessage } from "@/lib/data/chat";
import { formError, formSuccess } from "@/lib/form-state";
import { call } from "@/lib/services";
import { conversationSchema, fieldErrors, loadMessagesSchema, reportChatSchema, sendMessageSchema } from "@/lib/validation/schemas";

const text = (formData, name) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

const NOT_FOUND = "That conversation could not be found.";
const fail = (code, error) => ({ ok: false, code, error });
// What the three script-called actions answer when there is no session. They do
// not redirect: the chat screen reacts by leaving through a full page load.
const SIGNED_OUT = fail("not_authenticated", "Your session has ended. Log in again.");

/** Sends one message. Returns { ok: true, message } or { ok: false, code, error }. */
export async function sendMessageAction(input) {
  const session = await requireProfileOrSignedOut();
  if (!session) return SIGNED_OUT;
  const parsed = sendMessageSchema.safeParse(input ?? {});
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    return errors.body ? fail("invalid_message", errors.body) : fail("conversation_not_found", NOT_FOUND);
  }

  const { data, error } = await call("chat_send", {
    p_conversation: parsed.data.conversation,
    p_body: parsed.data.body,
    p_client_id: parsed.data.clientId,
  });
  if (error || !data?.[0]) {
    logServerError("chat.send", error);
    return fail(error?.message ?? "error", describeDbError(error));
  }
  return { ok: true, message: labelMessage(data[0]) };
}

/** Loads a bounded page: { conversation, before } for earlier messages, { conversation, after } to catch up. */
export async function loadMessagesAction(input) {
  const session = await requireProfileOrSignedOut();
  if (!session) return SIGNED_OUT;
  const parsed = loadMessagesSchema.safeParse(input ?? {});
  if (!parsed.success) return fail("conversation_not_found", NOT_FOUND);

  const { error, messages, hasEarlier } = await fetchMessages(parsed.data.conversation, parsed.data);
  if (error) {
    logServerError("chat.load", error);
    return fail(error.message ?? "error", describeDbError(error));
  }
  return { ok: true, messages, hasEarlier };
}

export async function blockChatPartnerAction(_previous, formData) {
  await requireProfile();
  const parsed = conversationSchema.safeParse({ conversation: text(formData, "conversation") });
  if (!parsed.success) return formError(NOT_FOUND);

  const { error } = await call("block_chat_partner", { p_conversation: parsed.data.conversation });
  if (error) {
    logServerError("chat.block", error);
    return formError(describeDbError(error));
  }
  revalidatePath("/", "layout");
  return formSuccess("Blocked. Neither of you can send messages in this conversation.");
}

export async function reportChatPartnerAction(_previous, formData) {
  await requireProfile();
  const values = { reason: text(formData, "reason"), details: text(formData, "details"), includeMessages: text(formData, "includeMessages") };
  const parsed = reportChatSchema.safeParse({ conversation: text(formData, "conversation"), ...values });
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    if (errors.conversation) return formError(NOT_FOUND);
    return formError("Check the highlighted fields.", { fieldErrors: errors, values });
  }

  const { data, error } = await call("report_chat_partner", {
    p_conversation: parsed.data.conversation,
    p_reason: parsed.data.reason,
    p_details: parsed.data.details,
    p_include_messages: parsed.data.includeMessages,
  });
  if (error) {
    logServerError("chat.report", error);
    return formError(describeDbError(error), { values });
  }
  return formSuccess(
    data === "already_reported"
      ? "You have already reported this conversation. The moderators have it."
      : "Report sent to the moderators. Thank you.",
  );
}
