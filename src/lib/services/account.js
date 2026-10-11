import "server-only";

// Leaving: account deletion (immediate, held, completed by a Super Admin), and
// the beta feedback inbox.
//
// Deleting an account
//   Erased:   the sign-in record and its sessions and emailed tokens, the
//             profile, private profile data, photo, event participations,
//             interests, matches and every message in those conversations (for
//             both people — a conversation belongs to a match), blocks,
//             moderation state.
//   Kept:     reports the student filed or that are about them (the link to the
//             account is emptied; any message excerpt a reporter attached stays),
//             audit-log entries (which carry a short reference, not a name),
//             and feedback (unlinked).
//   Held:     when the account is suspended or has undecided reports about it,
//             the request waits for a Super Admin, so that deleting an account
//             cannot be used to walk away from moderation.
//
// MongoDB is used here without multi-document transactions (they need a replica
// set). The steps are therefore ordered so that an interruption leaves an
// account that can simply be deleted again: the sign-in record goes last.

import {
  AccountDeletionRequest, AccountModeration, AdminCollegeAccess, AuthToken, Block, College, EventParticipant, Feedback, FEEDBACK_CATEGORIES,
  Interest, Match, Message, Photo, Profile, ProfilePrivate, Report, ReportNote, Session, User,
} from "@/lib/db/models";
import { audit, clampLimit, clampOffset, deny, fail, isUuid, requireSignedIn, requireSuperAdmin, shortRef } from "./core";

const iso = (date) => (date ? new Date(date).toISOString() : null);
const OPEN = ["open", "in_review"];

/** Removes everything listed above. `by` is "self" or "admin"; the audit entry names the real actor. */
async function eraseAccount(ctx, userId, by) {
  const profile = await Profile.findById(userId).select("college_id").lean();
  const ref = shortRef("U", userId);
  // Recorded first, without a name: a reference, the college, and by whom.
  await audit(ctx, "accounts.deleted", "profiles", userId, profile?.college_id ?? null, { ref, by });

  const mine = { $or: [{ user_a_id: userId }, { user_b_id: userId }] };
  const matchIds = (await Match.find(mine).select("_id").lean()).map((row) => row._id);
  await Message.deleteMany({ match_id: { $in: matchIds } });
  await Match.deleteMany(mine);
  await Interest.deleteMany({ $or: [{ from_user_id: userId }, { to_user_id: userId }] });
  await EventParticipant.deleteMany({ user_id: userId });
  await Block.deleteMany({ $or: [{ blocker_id: userId }, { blocked_id: userId }] });
  await Photo.deleteMany({ user_id: userId });
  await AccountModeration.deleteOne({ _id: userId });
  await ProfilePrivate.deleteOne({ _id: userId });
  await Profile.deleteOne({ _id: userId });
  await AdminCollegeAccess.deleteMany({ admin_user_id: userId });

  // Kept, but no longer pointing at an account.
  await Report.updateMany({ reporter_id: userId }, { $set: { reporter_id: null } });
  await Report.updateMany({ reported_user_id: userId }, { $set: { reported_user_id: null } });
  await Report.updateMany({ assigned_to: userId }, { $set: { assigned_to: null } });
  await Report.updateMany({ resolved_by: userId }, { $set: { resolved_by: null } });
  await ReportNote.updateMany({ author_id: userId }, { $set: { author_id: null } });
  await Feedback.updateMany({ user_id: userId }, { $set: { user_id: null } });
  await Feedback.updateMany({ reviewed_by: userId }, { $set: { reviewed_by: null } });

  await AccountDeletionRequest.updateOne(
    { _id: userId },
    { $set: { status: "completed", decided_at: new Date(), decided_by: by }, $setOnInsert: { user_ref: ref, college_id: profile?.college_id ?? null, requested_at: new Date(), hold_reason: null } },
    { upsert: true },
  );

  // Last: every session, every emailed link, and the sign-in record itself.
  await Session.deleteMany({ user_id: userId });
  await AuthToken.deleteMany({ user_id: userId });
  await User.deleteOne({ _id: userId });
}

/**
 * Deletes the caller's own account. There is no parameter: it is always the
 * caller's. (The Server Action checks the current password before calling.)
 *   → "deleted" | "pending"
 */
export async function delete_my_account(ctx) {
  const uid = requireSignedIn(ctx);
  const user = await User.findById(uid).select("role").lean();
  if (!user) deny("not_authenticated");
  // An admin's access has to be removed by a Super Admin first, on the record.
  if (user.role !== "student") fail("staff_cannot_self_delete");

  const profile = await Profile.findById(uid).select("status college_id").lean();
  let hold = null;
  if (profile?.status === "suspended") hold = "suspended";
  else if (profile && (await Report.exists({ reported_user_id: uid, status: { $in: OPEN } }))) hold = "open_reports";

  if (hold) {
    await AccountDeletionRequest.updateOne(
      { _id: uid },
      { $set: { status: "pending", hold_reason: hold, requested_at: new Date(), decided_at: null, decided_by: null, user_ref: shortRef("U", uid), college_id: profile.college_id } },
      { upsert: true },
    );
    await audit(ctx, "accounts.deletion_requested", "profiles", uid, profile.college_id, { ref: shortRef("U", uid), hold });
    return "pending";
  }
  await eraseAccount(ctx, uid, "self");
  return "deleted";
}

/** Withdraws a request that is waiting for a decision. */
export async function cancel_my_account_deletion(ctx) {
  const uid = requireSignedIn(ctx);
  const cancelled = await AccountDeletionRequest.updateOne({ _id: uid, status: "pending" }, { $set: { status: "cancelled", decided_at: new Date(), decided_by: "self" } });
  if (cancelled.modifiedCount !== 1) fail("no_deletion_request");
  const profile = await Profile.findById(uid).select("college_id").lean();
  await audit(ctx, "accounts.deletion_cancelled", "profiles", uid, profile?.college_id ?? null, { ref: shortRef("U", uid) });
}

/**
 * The caller's own waiting request, if any: { status, requested_at }. The reason
 * a request is held is deliberately NOT returned: "there are reports about you"
 * is something the reported person is never told.
 */
export async function my_deletion_request(ctx) {
  const uid = requireSignedIn(ctx);
  const request = await AccountDeletionRequest.findOne({ _id: uid, status: "pending" }).select("status requested_at").lean();
  return request ? { status: request.status, requested_at: iso(request.requested_at) } : null;
}

/** Super Admin: requests waiting for a decision. */
export async function admin_list_deletion_requests(ctx) {
  requireSuperAdmin(ctx);
  const requests = await AccountDeletionRequest.find({ status: "pending" }).sort({ requested_at: 1 }).limit(200).lean();
  const ids = requests.map((row) => row._id);
  const [profiles, colleges, open] = await Promise.all([
    Profile.find({ _id: { $in: ids } }).select("first_name").lean(),
    College.find({ _id: { $in: requests.map((row) => row.college_id).filter(Boolean) } }).select("name").lean(),
    Report.aggregate([{ $match: { reported_user_id: { $in: ids }, status: { $in: OPEN } } }, { $group: { _id: "$reported_user_id", n: { $sum: 1 } } }]),
  ]);
  const nameOf = new Map(profiles.map((row) => [row._id, row.first_name]));
  const collegeOf = new Map(colleges.map((row) => [row._id, row.name]));
  const openOf = new Map(open.map((row) => [row._id, row.n]));
  return requests.map((request) => ({
    user_id: request._id,
    user_ref: request.user_ref,
    first_name: nameOf.get(request._id) ?? null,
    college_name: collegeOf.get(request.college_id) ?? null,
    state: "pending",
    hold_reason: request.hold_reason,
    requested_at: iso(request.requested_at),
    decided_at: null,
    open_reports: openOf.get(request._id) ?? 0,
  }));
}

/**
 * Super Admin: carries out a held request. Only a request the student made and
 * has not withdrawn — an admin cannot delete an account nobody asked to have
 * deleted — and never their own or a staff account.
 */
export async function admin_complete_account_deletion(ctx, { p_user }) {
  const uid = requireSuperAdmin(ctx);
  if (!isUuid(p_user) || p_user === uid) fail("invalid_request");
  if (!(await AccountDeletionRequest.exists({ _id: p_user, status: "pending" }))) fail("no_deletion_request");
  const target = await User.findById(p_user).select("role").lean();
  if (target && target.role !== "student") fail("cannot_moderate_staff");
  await eraseAccount(ctx, p_user, "admin");
}

// ----------------------------------------------------------------------------- feedback
/** Any signed-in person may send feedback: five a day, validated here. The sender is the caller. */
export async function submit_feedback(ctx, { p_category, p_description, p_steps = null }) {
  const uid = requireSignedIn(ctx);
  const description = String(p_description ?? "").trim();
  const steps = typeof p_steps === "string" && p_steps.trim() !== "" ? p_steps.trim() : null;
  if (!FEEDBACK_CATEGORIES.includes(p_category)) fail("invalid_feedback_category");
  if (description.length < 10) fail("feedback_too_short");
  if (description.length > 1000 || (steps && steps.length > 1000)) fail("feedback_too_long");
  const today = await Feedback.countDocuments({ user_id: uid, created_at: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } });
  if (today >= 5) fail("feedback_limit_reached");
  const profile = await Profile.findById(uid).select("college_id").lean();
  await Feedback.create({ user_id: uid, college_id: profile?.college_id ?? null, category: p_category, description, steps });
}

/** Super Admin only. The sender appears as a reference code, never a name or an email address. */
export async function admin_list_feedback(ctx, { p_status = null, p_category = null, p_limit = 20, p_offset = 0 } = {}) {
  requireSuperAdmin(ctx);
  if ((p_status && !["new", "reviewed"].includes(p_status)) || (p_category && !FEEDBACK_CATEGORIES.includes(p_category))) fail("invalid_request");
  const filter = {};
  if (p_status) filter.status = p_status;
  if (p_category) filter.category = p_category;
  const [total, rows] = await Promise.all([
    Feedback.countDocuments(filter),
    Feedback.find(filter).sort({ created_at: -1, _id: 1 }).skip(clampOffset(p_offset)).limit(clampLimit(p_limit, 20, 100)).lean(),
  ]);
  const colleges = await College.find({ _id: { $in: rows.map((row) => row.college_id).filter(Boolean) } }).select("name").lean();
  const collegeOf = new Map(colleges.map((row) => [row._id, row.name]));
  return rows.map((row) => ({
    feedback_id: row._id,
    created_at: iso(row.created_at),
    category: row.category,
    description: row.description,
    steps: row.steps,
    status: row.status,
    college_name: collegeOf.get(row.college_id) ?? null,
    from_ref: row.user_id ? shortRef("U", row.user_id) : null,
    total,
  }));
}

export async function admin_set_feedback_reviewed(ctx, { p_feedback, p_reviewed }) {
  const uid = requireSuperAdmin(ctx);
  if (typeof p_reviewed !== "boolean") fail("invalid_request");
  const saved = isUuid(p_feedback)
    ? await Feedback.updateOne({ _id: p_feedback }, { $set: { status: p_reviewed ? "reviewed" : "new", reviewed_at: p_reviewed ? new Date() : null, reviewed_by: p_reviewed ? uid : null } })
    : { matchedCount: 0 };
  if (saved.matchedCount !== 1) fail("feedback_not_found");
}

/** Super Admin: what is waiting in the two inboxes above. */
export async function admin_inbox_counts(ctx) {
  requireSuperAdmin(ctx);
  return {
    deletion_requests: await AccountDeletionRequest.countDocuments({ status: "pending" }),
    feedback_new: await Feedback.countDocuments({ status: "new" }),
  };
}
