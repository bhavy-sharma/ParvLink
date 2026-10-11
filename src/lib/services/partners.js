import "server-only";

// Finding a partner: join an event, discover compatible students, send
// interest, match when it is mutual, block and report.
//
// Rules that hold whatever page or request is used:
//   * the caller is always the signed-in user — no function takes a user id;
//   * other students are addressed by a per-event handle, never by user id;
//   * eligibility, compatibility and blocks are re-checked on every call;
//   * "not available" is one answer for every reason (blocked, closed,
//     ineligible), so nobody can probe which one applies.

import { isDuplicateKey } from "@/lib/db/connection";
import { Block, College, Event, EventParticipant, Interest, Match, Photo, Profile, ProfilePrivate, Report } from "@/lib/db/models";
import { clampLimit, clampOffset, fail, isBlockedBetween, isUuid, requireUser } from "./core";
import { eventBlockers, eventInvitesCollege, participationBlockers, studentBlockers, visibleEvent } from "./events";

const GENDERS = ["male", "female"];
const PROFILE_REPORT_REASONS = ["fake_profile", "harassment", "misleading_information", "spam", "other"];
const pairOf = (one, two) => (one < two ? [one, two] : [two, one]);
const blocked = (blockers) => fail("participation_blocked", blockers.join(","));

async function participantUser(eventId, handle) {
  if (!isUuid(handle)) return null;
  const row = await EventParticipant.findOne({ event_id: eventId, public_id: handle }).select("user_id").lean();
  return row?.user_id ?? null;
}

/** May these two discover each other in this event right now? */
export async function pairDiscoverable(event, one, two) {
  if (one === two || eventBlockers(event).length > 0 || (await isBlockedBetween(one, two))) return false;
  const [p1, p2, g1, g2] = await Promise.all([
    EventParticipant.findOne({ event_id: event._id, user_id: one, status: "active" }).select("looking_for").lean(),
    EventParticipant.findOne({ event_id: event._id, user_id: two, status: "active" }).select("looking_for").lean(),
    ProfilePrivate.findById(one).select("gender").lean(),
    ProfilePrivate.findById(two).select("gender").lean(),
  ]);
  if (!p1 || !p2 || !g1?.gender || !g2?.gender) return false;
  if (p1.looking_for !== g2.gender || p2.looking_for !== g1.gender) return false;
  return (await studentBlockers(event, one)).length === 0 && (await studentBlockers(event, two)).length === 0;
}

/** May `me` see `other` in this event: an existing interest or match between them, or discoverable right now. Never across a block. */
export async function partnerVisible(eventId, me, other) {
  if (!me || !other || me === other || (await isBlockedBetween(me, other))) return false;
  const [low, high] = pairOf(me, other);
  const linked =
    (await Interest.exists({ event_id: eventId, $or: [{ from_user_id: me, to_user_id: other }, { from_user_id: other, to_user_id: me }] })) ||
    (await Match.exists({ event_id: eventId, user_a_id: low, user_b_id: high }));
  if (linked) return true;
  const event = await Event.findById(eventId).lean();
  return Boolean(event) && pairDiscoverable(event, me, other);
}

// ----------------------------------------------------------------------------- joining
/** Joins (or re-joins) an event with a partner preference. Gender is asked once and then fixed. */
export async function join_event(ctx, { p_event_id, p_looking_for, p_gender = null }) {
  const uid = await requireUser(ctx);
  const event = await visibleEvent(ctx, p_event_id);
  if (!GENDERS.includes(p_looking_for)) fail("invalid_preference");
  // Eligibility first: nothing is stored for a student who may not take part.
  const blockers = await participationBlockers(event, uid);
  if (blockers.length > 0) blocked(blockers);

  const mine = await ProfilePrivate.findById(uid).select("gender").lean();
  if (!mine?.gender) {
    if (!GENDERS.includes(p_gender)) fail("gender_required");
    // Only if it is still unset: two simultaneous joins cannot save two different answers.
    await ProfilePrivate.updateOne({ _id: uid, gender: null }, { $set: { gender: p_gender } });
    const saved = await ProfilePrivate.findById(uid).select("gender").lean();
    if (saved?.gender !== p_gender) fail("gender_locked");
  } else if (p_gender !== null && p_gender !== undefined && p_gender !== mine.gender) {
    fail("gender_locked");
  }

  const open = { status: "active", looking_for: p_looking_for, closed_at: null };
  try {
    await EventParticipant.updateOne({ event_id: event._id, user_id: uid }, { $set: open }, { upsert: true });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    await EventParticipant.updateOne({ event_id: event._id, user_id: uid }, { $set: open }); // a double submit raced the insert
  }
  return { status: "active", looking_for: p_looking_for };
}

/** Closes or re-opens the caller's profile for ONE event. Closing is always allowed. */
export async function set_event_profile_open(ctx, { p_event_id, p_open }) {
  const uid = await requireUser(ctx);
  if (typeof p_open !== "boolean") fail("invalid_request");
  const mine = isUuid(p_event_id) ? await EventParticipant.findOne({ event_id: p_event_id, user_id: uid }).lean() : null;
  if (!mine) fail("not_joined");
  if (!p_open) {
    await EventParticipant.updateOne({ _id: mine._id }, { $set: { status: "closed", closed_at: mine.closed_at ?? new Date() } });
    return "closed";
  }
  const event = await visibleEvent(ctx, p_event_id);
  const blockers = await participationBlockers(event, uid);
  if (blockers.length > 0) blocked(blockers);
  if (!mine.looking_for) fail("invalid_preference");
  await EventParticipant.updateOne({ _id: mine._id }, { $set: { status: "active", closed_at: null } });
  return "active";
}

/** The caller's own state for an event. */
export async function my_event_participation(ctx, { p_event_id }) {
  const uid = await requireUser(ctx);
  const event = await visibleEvent(ctx, p_event_id);
  const [row, mine, blockers] = await Promise.all([
    EventParticipant.findOne({ event_id: event._id, user_id: uid }).lean(),
    ProfilePrivate.findById(uid).select("gender").lean(),
    participationBlockers(event, uid),
  ]);
  return {
    joined: Boolean(row),
    status: row?.status ?? null,
    looking_for: row?.looking_for ?? null,
    gender: mine?.gender ?? null,
    blockers, // why the caller cannot take part right now (empty = they can)
    joined_at: row ? row.created_at.toISOString() : null,
  };
}

// ----------------------------------------------------------------------------- discovery
const card = (participant, profile) => ({
  handle: participant.public_id,
  first_name: profile.first_name,
  course: profile.course,
  study_year: profile.study_year,
  has_photo: Boolean(profile.avatar_path),
});

/**
 * Compatible students for this event, newest first. A card is exactly:
 * handle, first name, course, year, has-photo, and how the caller relates to
 * them. No user id, email, date of birth, gender or photo key.
 */
export async function discover_event_partners(ctx, { p_event_id, p_limit = 12, p_offset = 0 }) {
  const uid = await requireUser(ctx);
  const event = await visibleEvent(ctx, p_event_id);
  const me = await EventParticipant.findOne({ event_id: event._id, user_id: uid }).lean();
  if (!me) fail("not_joined");
  if (me.status !== "active") fail("profile_closed");
  const blockers = await participationBlockers(event, uid);
  if (blockers.length > 0) blocked(blockers);
  const myGender = (await ProfilePrivate.findById(uid).select("gender").lean())?.gender;

  // They are looking for someone like me…
  const candidates = await EventParticipant.find({ event_id: event._id, status: "active", user_id: { $ne: uid }, looking_for: myGender })
    .sort({ created_at: -1, public_id: 1 })
    .select("user_id public_id")
    .lean();
  const ids = candidates.map((row) => row.user_id);
  const [profiles, privates, blocks] = await Promise.all([
    Profile.find({ _id: { $in: ids } }).lean(),
    ProfilePrivate.find({ _id: { $in: ids } }).select("gender date_of_birth").lean(),
    Block.find({ $or: [{ blocker_id: uid, blocked_id: { $in: ids } }, { blocked_id: uid, blocker_id: { $in: ids } }] }).select("blocker_id blocked_id").lean(),
  ]);
  const profileOf = new Map(profiles.map((row) => [row._id, row]));
  const privateOf = new Map(privates.map((row) => [row._id, row]));
  const blockedIds = new Set(blocks.map((row) => (row.blocker_id === uid ? row.blocked_id : row.blocker_id)));
  const inviteCache = new Map();

  const eligible = [];
  for (const candidate of candidates) {
    const profile = profileOf.get(candidate.user_id);
    const priv = privateOf.get(candidate.user_id);
    // …and they are who I am looking for; no block either way; still eligible themselves.
    if (!profile || !priv || priv.gender !== me.looking_for || blockedIds.has(candidate.user_id)) continue;
    if ((await studentBlockers(event, candidate.user_id, { profile, dob: priv.date_of_birth }, inviteCache)).length > 0) continue;
    eligible.push({ candidate, profile });
  }

  const page = eligible.slice(clampOffset(p_offset), clampOffset(p_offset) + clampLimit(p_limit, 12, 48));
  const pageIds = page.map((item) => item.candidate.user_id);
  const [matches, sent, received] = await Promise.all([
    Match.find({ event_id: event._id, $or: [{ user_a_id: uid, user_b_id: { $in: pageIds } }, { user_b_id: uid, user_a_id: { $in: pageIds } }] }).select("user_a_id user_b_id").lean(),
    Interest.find({ event_id: event._id, from_user_id: uid, to_user_id: { $in: pageIds } }).select("to_user_id").lean(),
    Interest.find({ event_id: event._id, to_user_id: uid, from_user_id: { $in: pageIds } }).select("from_user_id").lean(),
  ]);
  const matched = new Set(matches.map((row) => (row.user_a_id === uid ? row.user_b_id : row.user_a_id)));
  const sentTo = new Set(sent.map((row) => row.to_user_id));
  const receivedFrom = new Set(received.map((row) => row.from_user_id));

  return page.map(({ candidate, profile }) => ({
    ...card(candidate, profile),
    relation: matched.has(candidate.user_id) ? "matched" : sentTo.has(candidate.user_id) ? "sent" : receivedFrom.has(candidate.user_id) ? "received" : "none",
    total: eligible.length,
  }));
}

// ----------------------------------------------------------------------------- interest and matching
/**
 * Sends interest. If the other student has already sent theirs, the two are
 * matched — exactly once, however many requests arrive at the same moment:
 * the unique indexes on interests and matches make every step repeatable.
 *   → { state: "sent" | "already_sent" | "matched" }
 */
export async function send_interest(ctx, { p_event_id, p_handle }) {
  const uid = await requireUser(ctx);
  const event = await visibleEvent(ctx, p_event_id);
  const target = await participantUser(event._id, p_handle);
  if (!target) fail("partner_not_available");
  if (target === uid) fail("self_interest");
  const [low, high] = pairOf(uid, target);
  if (await Match.exists({ event_id: event._id, user_a_id: low, user_b_id: high })) return { state: "matched" };

  const mine = await EventParticipant.findOne({ event_id: event._id, user_id: uid }).select("status").lean();
  if (!mine) fail("not_joined");
  if (mine.status !== "active") fail("profile_closed");
  const blockers = await participationBlockers(event, uid);
  if (blockers.length > 0) blocked(blockers);
  if (!(await pairDiscoverable(event, uid, target))) fail("partner_not_available");

  const mineToThem = { event_id: event._id, from_user_id: uid, to_user_id: target };
  let inserted = false;
  if (!(await Interest.exists(mineToThem))) {
    const today = await Interest.countDocuments({ event_id: event._id, from_user_id: uid, created_at: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } });
    if (today >= 50) fail("interest_limit_reached");
    try {
      await Interest.create(mineToThem);
      inserted = true;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error; // a double press: the first request stored it
    }
  }

  // My interest is stored before I look for theirs, and theirs before they look
  // for mine — so of two simultaneous senders at least one sees both.
  if (await Interest.exists({ event_id: event._id, from_user_id: target, to_user_id: uid })) {
    try {
      await Match.create({ event_id: event._id, user_a_id: low, user_b_id: high });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error; // the other side created it a moment ago
    }
    await Interest.updateMany(
      { event_id: event._id, status: "pending", $or: [mineToThem, { from_user_id: target, to_user_id: uid }] },
      { $set: { status: "accepted", responded_at: new Date() } },
    );
    return { state: "matched" };
  }
  return { state: inserted ? "sent" : "already_sent" };
}

export async function list_received_interests(ctx, { p_event_id }) {
  const uid = await requireUser(ctx);
  const event = await visibleEvent(ctx, p_event_id);
  const interests = await Interest.find({ event_id: event._id, to_user_id: uid }).sort({ created_at: -1 }).limit(100).lean();
  const ids = interests.map((row) => row.from_user_id);
  const [participants, profiles, matches, blocks] = await Promise.all([
    EventParticipant.find({ event_id: event._id, user_id: { $in: ids } }).select("user_id public_id").lean(),
    Profile.find({ _id: { $in: ids } }).select("first_name course study_year avatar_path").lean(),
    Match.find({ event_id: event._id, $or: [{ user_a_id: uid, user_b_id: { $in: ids } }, { user_b_id: uid, user_a_id: { $in: ids } }] }).select("user_a_id user_b_id").lean(),
    Block.find({ $or: [{ blocker_id: uid, blocked_id: { $in: ids } }, { blocked_id: uid, blocker_id: { $in: ids } }] }).select("blocker_id blocked_id").lean(),
  ]);
  const participantOf = new Map(participants.map((row) => [row.user_id, row]));
  const profileOf = new Map(profiles.map((row) => [row._id, row]));
  const matched = new Set(matches.map((row) => (row.user_a_id === uid ? row.user_b_id : row.user_a_id)));
  const blockedIds = new Set(blocks.map((row) => (row.blocker_id === uid ? row.blocked_id : row.blocker_id)));

  const people = [];
  for (const interest of interests) {
    const from = interest.from_user_id;
    const participant = participantOf.get(from);
    const profile = profileOf.get(from);
    if (!participant || !profile || blockedIds.has(from)) continue;
    const isMatched = matched.has(from);
    people.push({
      ...card(participant, profile),
      relation: isMatched ? "matched" : "received",
      available: !isMatched && (await pairDiscoverable(event, uid, from)),
      received_at: interest.created_at.toISOString(),
    });
  }
  return people;
}

/** Counts pending interests received for each event visible to the caller. */
export async function my_received_interest_counts(ctx) {
  const uid = await requireUser(ctx);
  const [profile, counts] = await Promise.all([
    Profile.findById(uid).select("college_id").lean(),
    Interest.aggregate([
      { $match: { to_user_id: uid, status: "pending" } },
      { $group: { _id: "$event_id", pending_count: { $sum: 1 } } },
      { $sort: { pending_count: -1 } },
    ]),
  ]);
  if (!profile || counts.length === 0) return [];

  const events = await Event.find({
    _id: { $in: counts.map((row) => row._id) },
    status: { $ne: "draft" },
  })
    .select("title slug college_id eligibility_rules")
    .lean();
  const collegeCache = new Map();
  const eventVisibility = await Promise.all(
    events.map(async (event) => [event, await eventInvitesCollege(event, profile.college_id, collegeCache)]),
  );
  const visibleEvents = new Map(eventVisibility.filter(([, visible]) => visible).map(([event]) => [event._id, event]));

  return counts.flatMap((row) => {
    const event = visibleEvents.get(row._id);
    return event ? [{ event_id: row._id, event_slug: event.slug, event_title: event.title, pending_count: row.pending_count }] : [];
  });
}

/** Numbers for the caller's own dashboard. */
export async function my_partner_summary(ctx) {
  const uid = await requireUser(ctx);
  const waiting = await Interest.find({ to_user_id: uid, status: "pending" }).select("from_user_id").lean();
  const senders = [...new Set(waiting.map((row) => row.from_user_id))];
  const blocks = senders.length
    ? await Block.find({ $or: [{ blocker_id: uid, blocked_id: { $in: senders } }, { blocked_id: uid, blocker_id: { $in: senders } }] }).select("blocker_id blocked_id").lean()
    : [];
  const blockedIds = new Set(blocks.map((row) => (row.blocker_id === uid ? row.blocked_id : row.blocker_id)));
  return {
    matches: await Match.countDocuments({ $or: [{ user_a_id: uid }, { user_b_id: uid }] }),
    waiting_interests: waiting.filter((row) => !blockedIds.has(row.from_user_id)).length,
    events_joined: await EventParticipant.countDocuments({ user_id: uid, status: "active" }),
  };
}

/** Number of matches the caller has not opened yet. */
export async function my_unread_match_count(ctx) {
  const uid = await requireUser(ctx);
  const [asA, asB] = await Promise.all([
    Match.countDocuments({ user_a_id: uid, user_a_seen: { $ne: true } }),
    Match.countDocuments({ user_b_id: uid, user_b_seen: { $ne: true } }),
  ]);
  return asA + asB;
}

/** Marks the caller's current matches as seen; matches created later stay unread. */
export async function mark_my_matches_seen(ctx) {
  const uid = await requireUser(ctx);
  await Promise.all([
    Match.updateMany({ user_a_id: uid, user_a_seen: { $ne: true } }, { $set: { user_a_seen: true } }),
    Match.updateMany({ user_b_id: uid, user_b_seen: { $ne: true } }, { $set: { user_b_seen: true } }),
  ]);
  return "seen";
}

/**
 * A partner's photo, by event handle — only for someone the caller may see in
 * that event (or the caller's own). → { data, content_type } or null.
 */
export async function partner_photo(ctx, { p_event_id, p_handle }) {
  const uid = await requireUser(ctx);
  if (!isUuid(p_event_id)) return null;
  const target = await participantUser(p_event_id, p_handle);
  if (!target || !(target === uid || (await partnerVisible(p_event_id, uid, target)))) return null;
  const profile = await Profile.findById(target).select("avatar_path").lean();
  if (!profile?.avatar_path) return null;
  const photo = await Photo.findOne({ _id: profile.avatar_path, user_id: target }).select("data content_type").lean();
  return photo ? { data: Buffer.from(photo.data.buffer ?? photo.data), content_type: photo.content_type } : null;
}

// ----------------------------------------------------------------------------- blocking
/** Stores a block (both directions take effect, in every event). Repeating it changes nothing. */
export async function insertBlock(blocker, blockedUser) {
  try {
    await Block.create({ blocker_id: blocker, blocked_id: blockedUser });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
  }
}

export async function block_partner(ctx, { p_event_id, p_handle }) {
  const uid = await requireUser(ctx);
  const target = isUuid(p_event_id) ? await participantUser(p_event_id, p_handle) : null;
  if (!target || target === uid) fail("partner_not_available");
  if (await Block.exists({ blocker_id: uid, blocked_id: target })) return; // already blocked
  // Only someone the caller can actually see: a handle alone is not enough.
  if (!(await partnerVisible(p_event_id, uid, target))) fail("partner_not_available");
  await insertBlock(uid, target);
}

export async function list_my_blocks(ctx) {
  const uid = await requireUser(ctx);
  const blocks = await Block.find({ blocker_id: uid }).sort({ created_at: -1 }).lean();
  const profiles = await Profile.find({ _id: { $in: blocks.map((row) => row.blocked_id) } }).select("first_name course").lean();
  const profileOf = new Map(profiles.map((row) => [row._id, row]));
  return blocks
    .filter((row) => profileOf.has(row.blocked_id))
    .map((row) => ({ block_id: row._id, first_name: profileOf.get(row.blocked_id).first_name, course: profileOf.get(row.blocked_id).course, blocked_at: row.created_at.toISOString() }));
}

/** Only the person who blocked can remove the block. */
export async function unblock_partner(ctx, { p_block_id }) {
  const uid = await requireUser(ctx);
  const removed = isUuid(p_block_id) ? await Block.deleteOne({ _id: p_block_id, blocker_id: uid }) : { deletedCount: 0 };
  if (removed.deletedCount !== 1) fail("block_not_found");
}

// ----------------------------------------------------------------------------- reporting
/** Limit shared by profile and chat reports: ten per person per day. */
export async function assertReportAllowance(uid) {
  const recent = await Report.countDocuments({ reporter_id: uid, created_at: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } });
  if (recent >= 10) fail("report_limit_reached");
}

/** Reports a profile the caller can see (or has blocked). → "reported" | "already_reported" */
export async function report_partner(ctx, { p_event_id, p_handle, p_reason, p_details = null }) {
  const uid = await requireUser(ctx);
  const target = isUuid(p_event_id) ? await participantUser(p_event_id, p_handle) : null;
  const details = typeof p_details === "string" && p_details.trim() !== "" ? p_details.trim() : null;
  if (!PROFILE_REPORT_REASONS.includes(p_reason)) fail("invalid_report_reason");
  if (details && details.length > 1000) fail("report_details_too_long");
  const allowed =
    target && target !== uid && ((await partnerVisible(p_event_id, uid, target)) || (await Block.exists({ blocker_id: uid, blocked_id: target })));
  if (!allowed) fail("partner_not_available");
  await assertReportAllowance(uid);

  const profile = await Profile.findById(target).select("college_id").lean();
  if (!profile || !(await College.exists({ _id: profile.college_id }))) fail("partner_not_available");
  try {
    // The reporter is the caller; the college is the reported student's own.
    await Report.create({ reporter_id: uid, reported_user_id: target, college_id: profile.college_id, event_id: p_event_id, reason: p_reason, details, open_key: `${uid}|${target}|${p_event_id}` });
  } catch (error) {
    if (isDuplicateKey(error, "open_key")) return "already_reported"; // one undecided report per person and event
    throw error;
  }
  return "reported";
}
