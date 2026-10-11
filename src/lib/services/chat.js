import "server-only";

// Private one-to-one chat between two matched students.
//
// A conversation IS a match, addressed by the match's random public id. There
// is no way to create one except by matching, and no function takes a user id:
//   * only the two students of the match can open, read or write it — admins
//     and Super Admins get the same "not found" as anyone else;
//   * the sender of a message is always the caller;
//   * messages cannot be edited or deleted by any function in this codebase.

import { isDuplicateKey } from "@/lib/db/connection";
import { Block, College, Event, EventParticipant, Match, Message, Profile, Report } from "@/lib/db/models";
import { clampLimit, fail, isBlockedBetween, isUuid, requireUser } from "./core";
import { assertReportAllowance, insertBlock } from "./partners";

const CHAT_REPORT_REASONS = ["harassment", "threats", "spam", "fake_profile", "inappropriate_content", "other"];
const otherOf = (match, uid) => (match.user_a_id === uid ? match.user_b_id : match.user_a_id);

/** The match behind a conversation id — only for one of its two students with an active account. */
async function chatMatch(conversation, uid) {
  const match = isUuid(conversation) ? await Match.findOne({ public_id: conversation, $or: [{ user_a_id: uid }, { user_b_id: uid }] }).lean() : null;
  if (!match || !(await Profile.exists({ _id: uid, status: "active" }))) fail("conversation_not_found");
  return match;
}

/** Can messages be sent: the match is active, neither blocked the other, both accounts are active. */
async function chatSendable(match) {
  if (match.status !== "active") return false;
  if (await isBlockedBetween(match.user_a_id, match.user_b_id)) return false;
  return (await Profile.countDocuments({ _id: { $in: [match.user_a_id, match.user_b_id] }, status: "active" })) === 2;
}

/** Normalises line endings, drops control characters, trims. Text stays text: nothing is interpreted. */
export function cleanMessageBody(body) {
  return String(body ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
}
const HAS_VISIBLE_TEXT = /[^\s​-‍⁠﻿]/;

const messageView = (message, uid) => ({
  seq: message.seq,
  body: message.body,
  created_at: message.created_at.toISOString(),
  mine: message.sender_id === uid,
  client_id: message.sender_id === uid ? message.client_id : null, // only the sender gets their own client id back
});

// ----------------------------------------------------------------------------- reading
/** The caller's conversations (optionally of one event), most recent activity first. */
export async function list_my_conversations(ctx, { p_event_id = null } = {}) {
  const uid = await requireUser(ctx);
  if (!(await Profile.exists({ _id: uid, status: "active" }))) return [];
  const filter = { $or: [{ user_a_id: uid }, { user_b_id: uid }] };
  if (p_event_id) {
    if (!isUuid(p_event_id)) return [];
    filter.event_id = p_event_id;
  }
  const matches = await Match.find(filter).sort({ created_at: -1 }).limit(200).lean();
  if (matches.length === 0) return [];

  const others = matches.map((match) => otherOf(match, uid));
  const [events, participants, profiles, blocks, lastMessages] = await Promise.all([
    Event.find({ _id: { $in: matches.map((match) => match.event_id) } }).select("slug title").lean(),
    EventParticipant.find({ event_id: { $in: matches.map((match) => match.event_id) }, user_id: { $in: others } }).select("event_id user_id public_id").lean(),
    Profile.find({ _id: { $in: others } }).select("first_name course study_year avatar_path status").lean(),
    Block.find({ $or: [{ blocker_id: uid, blocked_id: { $in: others } }, { blocked_id: uid, blocker_id: { $in: others } }] }).select("blocker_id blocked_id").lean(),
    // The latest message of each conversation is the one whose number equals the match's counter.
    Message.find({ $or: matches.filter((match) => match.last_seq > 0).map((match) => ({ match_id: match._id, seq: match.last_seq })).concat([{ match_id: "none", seq: -1 }]) }).select("match_id body created_at sender_id").lean(),
  ]);
  const eventOf = new Map(events.map((row) => [row._id, row]));
  const handleOf = new Map(participants.map((row) => [`${row.event_id}|${row.user_id}`, row.public_id]));
  const profileOf = new Map(profiles.map((row) => [row._id, row]));
  const blockedByMe = new Set(blocks.filter((row) => row.blocker_id === uid).map((row) => row.blocked_id));
  const blockedEither = new Set(blocks.map((row) => (row.blocker_id === uid ? row.blocked_id : row.blocker_id)));
  const lastOf = new Map(lastMessages.map((row) => [row.match_id, row]));
  const meActive = true; // checked above

  const rows = [];
  for (const match of matches) {
    const other = otherOf(match, uid);
    const event = eventOf.get(match.event_id);
    const profile = profileOf.get(other);
    const handle = handleOf.get(`${match.event_id}|${other}`);
    if (!event || !profile || !handle) continue;
    const last = lastOf.get(match._id) ?? null;
    rows.push({
      conversation: match.public_id,
      event_slug: event.slug,
      event_title: event.title,
      handle,
      first_name: profile.first_name,
      course: profile.course,
      study_year: profile.study_year,
      has_photo: Boolean(profile.avatar_path) && !blockedEither.has(other),
      matched_at: match.created_at.toISOString(),
      blocked_by_me: blockedByMe.has(other),
      can_send: match.status === "active" && !blockedEither.has(other) && meActive && profile.status === "active",
      last_body: last ? last.body.replace(/\s+/g, " ").slice(0, 120) : null,
      last_at: last ? last.created_at.toISOString() : null,
      last_mine: last ? last.sender_id === uid : null,
    });
  }
  return rows.sort((a, b) => (b.last_at ?? b.matched_at).localeCompare(a.last_at ?? a.matched_at));
}

/** Header data for one conversation. Approved partner fields only. */
export async function chat_open(ctx, { p_conversation }) {
  const uid = await requireUser(ctx);
  const match = await chatMatch(p_conversation, uid);
  const other = otherOf(match, uid);
  const [event, participant, profile, isBlocked, blockedByMe] = await Promise.all([
    Event.findById(match.event_id).select("slug title").lean(),
    EventParticipant.findOne({ event_id: match.event_id, user_id: other }).select("public_id").lean(),
    Profile.findById(other).select("first_name course study_year avatar_path").lean(),
    isBlockedBetween(uid, other),
    Block.exists({ blocker_id: uid, blocked_id: other }),
  ]);
  if (!event || !participant || !profile) fail("conversation_not_found");
  return {
    conversation: match.public_id,
    event_slug: event.slug,
    event_title: event.title,
    matched_at: match.created_at.toISOString(),
    partner: { handle: participant.public_id, first_name: profile.first_name, course: profile.course, study_year: profile.study_year, has_photo: Boolean(profile.avatar_path) && !isBlocked },
    can_send: await chatSendable(match),
    blocked_by_me: Boolean(blockedByMe),
  };
}

/**
 * A bounded page, oldest → newest.
 *   p_after  → messages newer than that number (catch-up)
 *   p_before → the page just before that number
 *   neither  → the latest page
 */
export async function chat_messages(ctx, { p_conversation, p_before = null, p_after = null, p_limit = 30 }) {
  const uid = await requireUser(ctx);
  const match = await chatMatch(p_conversation, uid);
  const limit = clampLimit(p_limit, 30, 101);
  if (Number.isInteger(p_after)) {
    const rows = await Message.find({ match_id: match._id, seq: { $gt: p_after } }).sort({ seq: 1 }).limit(limit).lean();
    return rows.map((row) => messageView(row, uid));
  }
  const filter = { match_id: match._id };
  if (Number.isInteger(p_before)) filter.seq = { $lt: p_before };
  const rows = await Message.find(filter).sort({ seq: -1 }).limit(limit).lean();
  return rows.reverse().map((row) => messageView(row, uid));
}

/** Number of the latest message — what the live-update stream watches. Same access rule as reading. */
export async function chat_latest_seq(ctx, { p_conversation }) {
  const uid = await requireUser(ctx);
  const match = await chatMatch(p_conversation, uid);
  return match.last_seq;
}

// ----------------------------------------------------------------------------- writing
/**
 * Stores one message from the caller.
 *   * idempotent per client-chosen message id: a double press or a retried
 *     request stores one message and returns it again;
 *   * refused with one neutral code when either student has blocked the other,
 *     an account is suspended or the match has ended;
 *   * at most 20 messages per sender per minute.
 */
export async function chat_send(ctx, { p_conversation, p_body, p_client_id }) {
  const uid = await requireUser(ctx);
  let match = await chatMatch(p_conversation, uid);
  if (typeof p_body !== "string") fail("invalid_request");
  const body = cleanMessageBody(p_body);
  if (!HAS_VISIBLE_TEXT.test(body)) fail("message_empty");
  if ([...body].length > 2000) fail("message_too_long");
  if (!isUuid(p_client_id)) fail("invalid_request");
  const clientId = p_client_id.toLowerCase();

  const already = await Message.findOne({ match_id: match._id, sender_id: uid, client_id: clientId }).lean();
  if (already) return [messageView(already, uid)];

  if (!(await chatSendable(match))) fail("messaging_unavailable");
  const lastMinute = await Message.countDocuments({ sender_id: uid, created_at: { $gt: new Date(Date.now() - 60 * 1000) } });
  if (lastMinute >= 20) fail("message_rate_limited");

  // Take the next number atomically; two simultaneous senders get different ones.
  match = await Match.findOneAndUpdate({ _id: match._id }, { $inc: { last_seq: 1 } }, { new: true }).lean();
  let stored;
  try {
    stored = await Message.create({ match_id: match._id, sender_id: uid, body, client_id: clientId, seq: match.last_seq });
  } catch (error) {
    if (!isDuplicateKey(error, "client_id")) throw error;
    // The same message was submitted twice at once: the other request stored it.
    const first = await Message.findOne({ match_id: match._id, sender_id: uid, client_id: clientId }).lean();
    return [messageView(first, uid)];
  }

  // A block that was being saved while this message was on its way wins: the
  // message is taken back and the send is refused.
  if (await isBlockedBetween(match.user_a_id, match.user_b_id)) {
    await Message.collection.deleteOne({ _id: stored._id });
    fail("messaging_unavailable");
  }
  return [messageView(stored.toObject(), uid)];
}

/** Blocks the other student of a conversation. The history stays readable for both; neither can send. */
export async function block_chat_partner(ctx, { p_conversation }) {
  const uid = await requireUser(ctx);
  const match = await chatMatch(p_conversation, uid);
  await insertBlock(uid, otherOf(match, uid));
}

/**
 * Reports the other student of a conversation. With `p_include_messages`, a
 * copy of the latest 20 messages is attached — the only way message text ever
 * reaches a moderator. → "reported" | "already_reported"
 */
export async function report_chat_partner(ctx, { p_conversation, p_reason, p_details = null, p_include_messages = false }) {
  const uid = await requireUser(ctx);
  const match = await chatMatch(p_conversation, uid);
  const other = otherOf(match, uid);
  const details = typeof p_details === "string" && p_details.trim() !== "" ? p_details.trim() : null;
  if (!CHAT_REPORT_REASONS.includes(p_reason)) fail("invalid_report_reason");
  if (details && details.length > 1000) fail("report_details_too_long");
  await assertReportAllowance(uid);

  let evidence = null;
  if (p_include_messages === true) {
    const latest = await Message.find({ match_id: match._id }).sort({ seq: -1 }).limit(20).lean();
    evidence = latest.reverse().map((row) => ({ seq: row.seq, from: row.sender_id === uid ? "reporter" : "reported", body: row.body, sent_at: row.created_at.toISOString() }));
    if (evidence.length === 0) evidence = null;
  }
  const profile = await Profile.findById(other).select("college_id").lean();
  if (!profile || !(await College.exists({ _id: profile.college_id }))) fail("conversation_not_found");
  try {
    await Report.create({
      reporter_id: uid, reported_user_id: other, college_id: profile.college_id, event_id: match.event_id, match_id: match._id,
      reason: p_reason, details, evidence, open_key: `${uid}|chat|${match._id}`,
    });
  } catch (error) {
    if (isDuplicateKey(error, "open_key")) return "already_reported"; // one undecided report per conversation
    throw error;
  }
  return "reported";
}
