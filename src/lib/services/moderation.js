import "server-only";

// Report handling, account moderation and the audit log, for admins.
//
// Every function starts by requiring an admin and then narrows to the colleges
// and permissions that admin actually holds:
//   moderate_reports   reports about students of that college
//   view_students      student list and summaries
//   manage_students    flag, suspend, restore
// A college id in a request can only narrow that scope, never widen it, and
// "not found" and "not yours" give the same answer.
// Nothing here reads the messages collection: the only message text a
// moderator can reach is what a reporter attached to a report, and every look
// at it is recorded first.

import { zonedInputToDate } from "@/lib/dates";
import { isDuplicateKey } from "@/lib/db/connection";
import { AccountModeration, AuditLog, Block, College, Event, EventParticipant, Interest, Match, Profile, Report, REPORT_REASONS, REPORT_STATUSES, ReportNote, User } from "@/lib/db/models";
import {
  actorLabel, adminColleges, audit, clampLimit, clampOffset, countBy, deny, escapeRegex, fail, hasCollegePermission, isSuperAdmin, isUuid, requireAdmin, shortRef,
} from "./core";

const iso = (date) => (date ? new Date(date).toISOString() : null);
const OPEN = ["open", "in_review"];
const isDay = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Calendar days in a time zone → [from, to) as instants. Either end may be open. */
export function dayBounds(from, to, timeZone) {
  if (from && to && from > to) fail("invalid_date_range");
  const nextDay = (day) => new Date(new Date(`${day}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
  return {
    from: isDay(from) ? zonedInputToDate(`${from}T00:00`, timeZone) : null,
    to: isDay(to) ? zonedInputToDate(`${nextDay(to)}T00:00`, timeZone) : null,
  };
}
export function periodFilter(field, { from, to }) {
  if (!from && !to) return {};
  return { [field]: { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) } };
}

const kindOf = (report) => (report.match_id || report.evidence ? "chat" : "profile");

/** The report, if the caller may moderate it. Never a report they filed or that is about them — Super Admins included. */
async function moderatorReport(ctx, reportId) {
  const uid = requireAdmin(ctx);
  const report = isUuid(reportId) ? await Report.findById(reportId).lean() : null;
  if (!report || !(await hasCollegePermission(ctx, report.college_id, "moderate_reports")) || uid === report.reporter_id || uid === report.reported_user_id) {
    fail("report_not_found");
  }
  return report;
}

/** May the caller take moderation actions on this account: never themselves; staff only by a Super Admin; a Super Admin by nobody. */
async function canModerateUser(ctx, profile) {
  if (!profile || profile._id === ctx.uid) return false;
  if (!(await hasCollegePermission(ctx, profile.college_id, "manage_students"))) return false;
  const role = (await User.findById(profile._id).select("role").lean())?.role ?? "student";
  return role === "student" || (isSuperAdmin(ctx) && role !== "super_admin");
}

async function accountHistory(ctx, userId) {
  const entries = await AuditLog.find({ target_table: "profiles", target_id: userId }).sort({ seq: 1 }).lean();
  const roles = new Map();
  const history = [];
  for (const entry of entries) {
    history.push({
      action: entry.action,
      created_at: iso(entry.created_at),
      by: await actorLabel(ctx, entry.actor_id, roles),
      reason: entry.metadata?.reason ?? null,
      until: entry.metadata?.until ?? null,
      report_ref: entry.metadata?.report_ref ?? null,
      automatic: entry.metadata?.automatic === true,
    });
  }
  return history;
}

// ----------------------------------------------------------------------------- reports: lists
export async function admin_list_reports(ctx, { p_status = null, p_reason = null, p_college = null, p_event = null, p_from = null, p_to = null, p_search = null, p_assigned = null, p_limit = 20, p_offset = 0, p_tz = "Asia/Kolkata" } = {}) {
  const uid = requireAdmin(ctx);
  const scope = await adminColleges(ctx, ["moderate_reports"]);
  const period = dayBounds(p_from, p_to, p_tz);
  if (p_status && !REPORT_STATUSES.includes(p_status)) fail("invalid_request");
  if (p_assigned && !["me", "none"].includes(p_assigned)) fail("invalid_request");

  const filter = {
    college_id: p_college ? (scope.includes(p_college) ? p_college : "__none__") : { $in: scope },
    // Reports the caller filed, or that are about the caller, are someone else's to handle.
    reporter_id: { $ne: uid },
    reported_user_id: { $ne: uid },
    ...periodFilter("created_at", period),
  };
  if (p_status) filter.status = p_status;
  if (p_reason) filter.reason = p_reason;
  if (p_event) filter.event_id = p_event;
  if (p_assigned === "me") filter.assigned_to = uid;
  if (p_assigned === "none") filter.assigned_to = null;

  const q = typeof p_search === "string" ? p_search.trim() : "";
  if (/^r-[0-9a-f]{1,8}$/i.test(q)) {
    filter._id = { $regex: `^${q.slice(2).toLowerCase()}` };
  } else if (q) {
    // By the reported student's first name, among students of the colleges in scope.
    const named = await Profile.find({ college_id: { $in: scope }, first_name_lower: { $regex: `^${escapeRegex(q.toLowerCase().slice(0, 80))}` } }).select("_id").limit(500).lean();
    filter.$and = [{ reported_user_id: { $in: named.map((row) => row._id) } }];
  }

  const [total, reports] = await Promise.all([
    Report.countDocuments(filter),
    Report.find(filter).sort({ created_at: -1, _id: 1 }).skip(clampOffset(p_offset)).limit(clampLimit(p_limit, 20, 100)).select("-details -evidence -resolution_note").lean(),
  ]);
  const withEvidence = new Set((await Report.find({ _id: { $in: reports.map((row) => row._id) }, evidence: { $ne: null } }).select("_id").lean()).map((row) => row._id));
  const people = [...new Set(reports.flatMap((row) => [row.reported_user_id, row.reporter_id]).filter(Boolean))];
  const [colleges, events, profiles] = await Promise.all([
    College.find({ _id: { $in: reports.map((row) => row.college_id) } }).select("name").lean(),
    Event.find({ _id: { $in: reports.map((row) => row.event_id).filter(Boolean) } }).select("title").lean(),
    Profile.find({ _id: { $in: people } }).select("first_name status").lean(),
  ]);
  const collegeOf = new Map(colleges.map((row) => [row._id, row.name]));
  const eventOf = new Map(events.map((row) => [row._id, row.title]));
  const profileOf = new Map(profiles.map((row) => [row._id, row]));

  return reports.map((report) => ({
    report_id: report._id,
    ref: shortRef("R", report._id),
    created_at: iso(report.created_at),
    reason: report.reason,
    status: report.status,
    kind: report.match_id || withEvidence.has(report._id) ? "chat" : "profile",
    college_id: report.college_id,
    college_name: collegeOf.get(report.college_id) ?? null,
    event_id: report.event_id,
    event_title: report.event_id ? (eventOf.get(report.event_id) ?? null) : null,
    reported_user_id: report.reported_user_id,
    reported_ref: report.reported_user_id ? shortRef("U", report.reported_user_id) : null,
    reported_name: profileOf.get(report.reported_user_id)?.first_name ?? null,
    reported_status: profileOf.get(report.reported_user_id)?.status ?? null,
    reporter_ref: report.reporter_id ? shortRef("U", report.reporter_id) : null,
    reporter_name: profileOf.get(report.reporter_id)?.first_name ?? null,
    assigned: Boolean(report.assigned_to),
    assigned_to_me: report.assigned_to === uid,
    has_evidence: withEvidence.has(report._id),
    total,
  }));
}

/** Events that have reports in the caller's scope, for the filter on the reports screen. */
export async function admin_report_events(ctx) {
  requireAdmin(ctx);
  const scope = await adminColleges(ctx, ["moderate_reports"]);
  const ids = (await Report.distinct("event_id", { college_id: { $in: scope }, event_id: { $ne: null } })).filter(Boolean);
  const events = await Event.find({ _id: { $in: ids } }).select("title starts_at").sort({ starts_at: -1 }).limit(200).lean();
  return events.map((event) => ({ event_id: event._id, title: event.title }));
}

// ----------------------------------------------------------------------------- reports: one report
/** Everything a moderator needs to decide a report — except the attached messages, which need a separate, logged request. */
export async function admin_get_report(ctx, { p_report }) {
  const uid = requireAdmin(ctx);
  const report = await moderatorReport(ctx, p_report);
  const scope = await adminColleges(ctx, ["moderate_reports"]);

  let reported = null;
  if (report.reported_user_id) {
    const profile = await Profile.findById(report.reported_user_id).lean();
    if (profile) {
      const [college, moderation, role] = await Promise.all([
        College.findById(profile.college_id).select("name").lean(),
        AccountModeration.findById(profile._id).lean(),
        User.findById(profile._id).select("role").lean(),
      ]);
      reported = {
        user_id: profile._id,
        ref: shortRef("U", profile._id),
        first_name: profile.first_name,
        course: profile.course,
        study_year: profile.study_year,
        college_name: college?.name ?? null,
        status: profile.status,
        under_review: Boolean(moderation?.under_review),
        suspended_until: profile.status === "suspended" ? iso(moderation?.suspended_until) : null,
        is_staff: (role?.role ?? "student") !== "student",
        can_view: await hasCollegePermission(ctx, profile.college_id, "view_students", "manage_students"),
        can_moderate: await canModerateUser(ctx, profile),
        reports_total: await Report.countDocuments({ reported_user_id: profile._id, college_id: { $in: scope } }),
        reports_open: await Report.countDocuments({ reported_user_id: profile._id, college_id: { $in: scope }, status: { $in: OPEN } }),
      };
    }
  }

  let reporter = null;
  if (report.reporter_id) {
    const profile = await Profile.findById(report.reporter_id).select("first_name college_id").lean();
    if (profile) {
      reporter = {
        ref: shortRef("U", profile._id),
        first_name: profile.first_name,
        college_name: (await College.findById(profile.college_id).select("name").lean())?.name ?? null,
        reports_filed: await Report.countDocuments({ reporter_id: profile._id, college_id: { $in: scope } }),
      };
    }
  }

  const [college, event, match, notes, entries, others] = await Promise.all([
    College.findById(report.college_id).select("name").lean(),
    report.event_id ? Event.findById(report.event_id).select("title status starts_at").lean() : null,
    report.match_id ? Match.findById(report.match_id).select("created_at status").lean() : null,
    ReportNote.find({ report_id: report._id }).sort({ created_at: 1, _id: 1 }).lean(),
    AuditLog.find({ target_table: "reports", target_id: report._id }).sort({ seq: 1 }).lean(),
    report.reported_user_id
      ? Report.find({ reported_user_id: report.reported_user_id, _id: { $ne: report._id }, college_id: { $in: scope }, reporter_id: { $ne: uid } })
          .sort({ created_at: -1 }).limit(10).select("reason status created_at").lean()
      : [],
  ]);
  const roles = new Map();
  const noteViews = [];
  for (const note of notes) noteViews.push({ id: note._id, body: note.body, created_at: iso(note.created_at), by: await actorLabel(ctx, note.author_id, roles) });
  const history = [];
  for (const entry of entries) {
    history.push({ action: entry.action, created_at: iso(entry.created_at), by: await actorLabel(ctx, entry.actor_id, roles), from: entry.metadata?.from ?? null, to: entry.metadata?.to ?? null, note: entry.metadata?.note ?? null });
  }

  return {
    report: {
      id: report._id,
      ref: shortRef("R", report._id),
      created_at: iso(report.created_at),
      reason: report.reason,
      details: report.details,
      status: report.status,
      kind: kindOf(report),
      resolved_at: iso(report.resolved_at),
      resolution_note: report.resolution_note,
      assigned: Boolean(report.assigned_to),
      assigned_to_me: report.assigned_to === uid,
      evidence_count: Array.isArray(report.evidence) ? report.evidence.length : 0,
    },
    college: college ? { id: college._id, name: college.name } : null,
    event: event ? { id: event._id, title: event.title, status: event.status, starts_at: iso(event.starts_at) } : null,
    match: match ? { matched_at: iso(match.created_at), status: match.status } : null,
    blocked_between:
      report.reporter_id && report.reported_user_id
        ? Boolean(await Block.exists({ $or: [{ blocker_id: report.reporter_id, blocked_id: report.reported_user_id }, { blocker_id: report.reported_user_id, blocked_id: report.reporter_id }] }))
        : null,
    reported,
    reporter,
    notes: noteViews,
    history,
    account_history: report.reported_user_id ? await accountHistory(ctx, report.reported_user_id) : [],
    other_reports: others.map((row) => ({ id: row._id, ref: shortRef("R", row._id), reason: row.reason, status: row.status, created_at: iso(row.created_at) })),
  };
}

/** The messages a reporter chose to attach. The view is recorded BEFORE they are returned. */
export async function admin_view_report_evidence(ctx, { p_report }) {
  const report = await moderatorReport(ctx, p_report);
  if (!Array.isArray(report.evidence) || report.evidence.length === 0) return [];
  await audit(ctx, "reports.evidence_viewed", "reports", report._id, report.college_id, { ref: shortRef("R", report._id), messages: report.evidence.length });
  return report.evidence;
}

// ----------------------------------------------------------------------------- reports: workflow
/**
 * open ⇄ in_review → resolved / dismissed → in_review (re-open).
 * Closing and re-opening need a written reason. What the student submitted is
 * never touched: only status, assignment and decision fields change.
 */
export async function admin_set_report_status(ctx, { p_report, p_status, p_note = null }) {
  const uid = requireAdmin(ctx);
  const report = await moderatorReport(ctx, p_report);
  const note = typeof p_note === "string" && p_note.trim() !== "" ? p_note.trim() : null;
  if (!REPORT_STATUSES.includes(p_status)) fail("invalid_request");
  const wasClosed = ["resolved", "dismissed"].includes(report.status);
  if (p_status === report.status || (wasClosed && p_status !== "in_review")) fail("invalid_report_transition");
  const closing = ["resolved", "dismissed"].includes(p_status);
  if (note && note.length > 1000) fail("decision_note_too_long");
  if ((closing || wasClosed) && (!note || note.length < 10)) fail("decision_note_required");

  const changes = {
    status: p_status,
    resolved_at: closing ? new Date() : null,
    resolved_by: closing ? uid : null,
    resolution_note: closing ? note : null,
    // A decided report frees the pair for a new report; see models.js → open_key.
    ...(closing ? { open_key: report._id } : {}),
  };
  if (p_status === "in_review" && !report.assigned_to) changes.assigned_to = uid; // whoever starts the review owns it
  // Only if it is still in the status this admin saw: two moderators cannot both decide it.
  const saved = await Report.updateOne({ _id: report._id, status: report.status }, { $set: changes });
  if (saved.modifiedCount !== 1) fail("invalid_report_transition");

  if (wasClosed && report.reporter_id && report.reported_user_id) {
    // Re-opened: make it the pair's undecided report again, unless a newer one took that place.
    const key = report.match_id ? `${report.reporter_id}|chat|${report.match_id}` : `${report.reporter_id}|${report.reported_user_id}|${report.event_id}`;
    await Report.updateOne({ _id: report._id }, { $set: { open_key: key } }).catch((error) => {
      if (!isDuplicateKey(error)) throw error;
    });
  }
  await audit(ctx, "reports.status_changed", "reports", report._id, report.college_id, { ref: shortRef("R", report._id), from: report.status, to: p_status, note });
  return p_status;
}

/** "Assign to me" / "unassign". Only the assignee or a Super Admin can unassign. */
export async function admin_assign_report(ctx, { p_report, p_assign }) {
  const uid = requireAdmin(ctx);
  const report = await moderatorReport(ctx, p_report);
  if (typeof p_assign !== "boolean") fail("invalid_request");
  if (p_assign) {
    if (report.assigned_to === uid) return;
    await Report.updateOne({ _id: report._id }, { $set: { assigned_to: uid } });
    await audit(ctx, "reports.assigned", "reports", report._id, report.college_id, { ref: shortRef("R", report._id), took_over: Boolean(report.assigned_to) });
    return;
  }
  if (!report.assigned_to) return;
  if (report.assigned_to !== uid && !isSuperAdmin(ctx)) deny();
  await Report.updateOne({ _id: report._id }, { $set: { assigned_to: null } });
  await audit(ctx, "reports.unassigned", "reports", report._id, report.college_id, { ref: shortRef("R", report._id) });
}

/** Internal note for moderators. The log records that a note was added and its length — never its text. */
export async function admin_add_report_note(ctx, { p_report, p_body }) {
  const uid = requireAdmin(ctx);
  const report = await moderatorReport(ctx, p_report);
  const body = String(p_body ?? "").trim();
  if (body.length < 1) fail("note_empty");
  if (body.length > 2000) fail("note_too_long");
  await ReportNote.create({ report_id: report._id, author_id: uid, body });
  await audit(ctx, "reports.note_added", "reports", report._id, report.college_id, { ref: shortRef("R", report._id), length: body.length });
}

// ----------------------------------------------------------------------------- students
/** Students of the colleges where the caller may see students. Approved fields only: no email, date of birth or gender. */
export async function admin_list_users(ctx, { p_search = null, p_college = null, p_status = null, p_limit = 20, p_offset = 0 } = {}) {
  const uid = requireAdmin(ctx);
  const scope = await adminColleges(ctx, ["view_students", "manage_students"]);
  const reportScope = await adminColleges(ctx, ["moderate_reports"]);
  if (p_status && !["active", "suspended", "under_review"].includes(p_status)) fail("invalid_request");

  const filter = { college_id: p_college ? (scope.includes(p_college) ? p_college : "__none__") : { $in: scope } };
  if (p_status === "active" || p_status === "suspended") filter.status = p_status;
  const q = typeof p_search === "string" ? p_search.trim() : "";
  if (/^u-[0-9a-f]{1,8}$/i.test(q)) filter._id = { $regex: `^${q.slice(2).toLowerCase()}` };
  else if (q) filter.first_name_lower = { $regex: `^${escapeRegex(q.toLowerCase().slice(0, 80))}` };
  if (p_status === "under_review") {
    const flagged = (await AccountModeration.find({ under_review: true }).select("_id").lean()).map((row) => row._id);
    filter.$and = [{ _id: { $in: flagged } }];
  }

  const [total, profiles] = await Promise.all([
    Profile.countDocuments(filter),
    Profile.find(filter).sort({ first_name_lower: 1, _id: 1 }).skip(clampOffset(p_offset)).limit(clampLimit(p_limit, 20, 100)).lean(),
  ]);
  const ids = profiles.map((row) => row._id);
  const [colleges, moderation, openReports] = await Promise.all([
    College.find({ _id: { $in: profiles.map((row) => row.college_id) } }).select("name").lean(),
    AccountModeration.find({ _id: { $in: ids } }).lean(),
    countBy(Report, "reported_user_id", ids, { status: { $in: OPEN }, reporter_id: { $ne: uid }, college_id: { $in: reportScope } }),
  ]);
  const collegeOf = new Map(colleges.map((row) => [row._id, row.name]));
  const moderationOf = new Map(moderation.map((row) => [row._id, row]));

  return profiles.map((profile) => ({
    user_id: profile._id,
    ref: shortRef("U", profile._id),
    first_name: profile.first_name,
    college_id: profile.college_id,
    college_name: collegeOf.get(profile.college_id) ?? null,
    course: profile.course,
    study_year: profile.study_year,
    status: profile.status,
    under_review: Boolean(moderationOf.get(profile._id)?.under_review),
    suspended_until: profile.status === "suspended" ? iso(moderationOf.get(profile._id)?.suspended_until) : null,
    joined_at: iso(profile.created_at),
    // Report numbers only where the caller moderates reports for that college — and never about the caller.
    open_reports: reportScope.includes(profile.college_id) && profile._id !== uid ? (openReports.get(profile._id) ?? 0) : null,
    total,
  }));
}

/** One student's summary: standing, participation counts and moderation history. No email, date of birth, gender or messages. */
export async function admin_get_user(ctx, { p_user }) {
  const uid = requireAdmin(ctx);
  const profile = isUuid(p_user) ? await Profile.findById(p_user).lean() : null;
  if (!profile || !(await hasCollegePermission(ctx, profile.college_id, "view_students", "manage_students"))) fail("student_not_found");
  const [role, college, moderation] = await Promise.all([
    User.findById(profile._id).select("role").lean(),
    College.findById(profile.college_id).select("name").lean(),
    AccountModeration.findById(profile._id).lean(),
  ]);
  const seesReports = (await hasCollegePermission(ctx, profile.college_id, "moderate_reports")) && profile._id !== uid;

  const joined = await EventParticipant.find({ user_id: profile._id }).sort({ created_at: -1 }).limit(20).lean();
  const events = await Event.find({ _id: { $in: joined.map((row) => row.event_id) } }).select("title status").lean();
  const eventOf = new Map(events.map((row) => [row._id, row]));

  return {
    user: {
      user_id: profile._id,
      ref: shortRef("U", profile._id),
      first_name: profile.first_name,
      college: { id: profile.college_id, name: college?.name ?? null },
      course: profile.course,
      study_year: profile.study_year,
      has_photo: Boolean(profile.avatar_path),
      joined_at: iso(profile.created_at),
      status: profile.status,
      under_review: Boolean(moderation?.under_review),
      suspended_at: profile.status === "suspended" ? iso(moderation?.suspended_at) : null,
      suspended_until: profile.status === "suspended" ? iso(moderation?.suspended_until) : null,
      is_staff: (role?.role ?? "student") !== "student",
      is_me: profile._id === uid,
    },
    can_moderate: await canModerateUser(ctx, profile),
    participation: {
      events_joined: await EventParticipant.countDocuments({ user_id: profile._id }),
      open_event_profiles: await EventParticipant.countDocuments({ user_id: profile._id, status: "active" }),
      interests_sent: await Interest.countDocuments({ from_user_id: profile._id }),
      interests_received: await Interest.countDocuments({ to_user_id: profile._id }),
      matches: await Match.countDocuments({ $or: [{ user_a_id: profile._id }, { user_b_id: profile._id }] }),
      events: joined.filter((row) => eventOf.has(row.event_id)).map((row) => ({ title: eventOf.get(row.event_id).title, event_status: eventOf.get(row.event_id).status, profile: row.status, joined_at: iso(row.created_at) })),
    },
    reports: seesReports
      ? {
          against_total: await Report.countDocuments({ reported_user_id: profile._id, reporter_id: { $ne: uid } }),
          against_open: await Report.countDocuments({ reported_user_id: profile._id, status: { $in: OPEN }, reporter_id: { $ne: uid } }),
          filed_total: await Report.countDocuments({ reporter_id: profile._id, reported_user_id: { $ne: uid } }),
        }
      : null,
    history: await accountHistory(ctx, profile._id),
  };
}

/**
 * flag_review / clear_review / suspend / restore. Suspending and flagging need
 * a written reason; every action is logged with the real actor.
 * Suspension changes one field (profiles.status); every partner and chat
 * service refuses a suspended account, whatever page or request is used.
 */
export async function admin_moderate_user(ctx, { p_user, p_action, p_reason = null, p_days = null, p_report = null }) {
  const uid = requireAdmin(ctx);
  const profile = isUuid(p_user) ? await Profile.findById(p_user).lean() : null;
  if (!profile || !(await hasCollegePermission(ctx, profile.college_id, "manage_students"))) fail("student_not_found");
  if (profile._id === uid) fail("cannot_moderate_self");
  if (!(await canModerateUser(ctx, profile))) fail("cannot_moderate_staff");
  if (!["flag_review", "clear_review", "suspend", "restore"].includes(p_action)) fail("invalid_request");
  const reason = typeof p_reason === "string" && p_reason.trim() !== "" ? p_reason.trim() : null;
  if (reason && reason.length > 500) fail("moderation_reason_too_long");
  if (["flag_review", "suspend"].includes(p_action) && (!reason || reason.length < 10)) fail("moderation_reason_required");

  let reportRef = null;
  if (p_report) {
    const linked = isUuid(p_report) ? await Report.findOne({ _id: p_report, reported_user_id: profile._id }).select("_id").lean() : null;
    if (!linked) fail("invalid_request"); // a decision can only be tied to a report about this student
    reportRef = shortRef("R", linked._id);
  }

  await AccountModeration.updateOne({ _id: profile._id }, { $setOnInsert: { under_review: false } }, { upsert: true }).catch((error) => {
    if (!isDuplicateKey(error)) throw error;
  });
  let until = null;
  if (p_action === "suspend") {
    if (p_days !== null && p_days !== undefined) {
      if (!Number.isInteger(p_days) || p_days < 1 || p_days > 365) fail("invalid_request");
      until = new Date(Date.now() + p_days * 86400000);
    }
    const changed = await Profile.updateOne({ _id: profile._id, status: "active" }, { $set: { status: "suspended" } });
    if (changed.modifiedCount !== 1) fail("already_suspended");
    await AccountModeration.updateOne({ _id: profile._id }, { $set: { suspended_at: new Date(), suspended_until: until, updated_by: uid } });
  } else if (p_action === "restore") {
    const changed = await Profile.updateOne({ _id: profile._id, status: "suspended" }, { $set: { status: "active" } });
    if (changed.modifiedCount !== 1) fail("not_suspended");
    await AccountModeration.updateOne({ _id: profile._id }, { $set: { suspended_at: null, suspended_until: null, updated_by: uid } });
  } else if (p_action === "flag_review") {
    const changed = await AccountModeration.updateOne({ _id: profile._id, under_review: { $ne: true } }, { $set: { under_review: true, updated_by: uid } });
    if (changed.modifiedCount !== 1) fail("already_under_review");
  } else {
    const changed = await AccountModeration.updateOne({ _id: profile._id, under_review: true }, { $set: { under_review: false, updated_by: uid } });
    if (changed.modifiedCount !== 1) fail("not_under_review");
  }

  await audit(ctx, `profiles.${p_action}`, "profiles", profile._id, profile.college_id, {
    ref: shortRef("U", profile._id), reason, until: until ? until.toISOString() : null, days: p_days ?? null, report_ref: reportRef,
  });
  return { action: p_action, until: until ? until.toISOString() : null };
}

// ----------------------------------------------------------------------------- audit log
/**
 * A page of the audit log, limited to what the caller may read:
 *   Super Admin    everything;
 *   college admin  entries of their colleges — events with manage_events,
 *                  reports with moderate_reports, student accounts with
 *                  manage_students or moderate_reports. Role and college-access
 *                  entries are Super Admin only.
 */
export async function list_audit(ctx, { category = null, college = null, from = null, to = null, limit = 20, offset = 0 } = {}) {
  requireAdmin(ctx);
  const filter = {};
  if (!isSuperAdmin(ctx)) {
    const [events, reports, students] = await Promise.all([
      adminColleges(ctx, ["manage_events"]),
      adminColleges(ctx, ["moderate_reports"]),
      adminColleges(ctx, ["manage_students", "moderate_reports"]),
    ]);
    filter.$or = [
      { target_table: "events", college_id: { $in: events } },
      { target_table: "reports", college_id: { $in: reports } },
      { target_table: "profiles", college_id: { $in: students } },
    ];
  }
  const and = [];
  if (category) and.push({ target_table: String(category) });
  if (college) and.push({ college_id: String(college) });
  const created = {};
  if (from && !Number.isNaN(new Date(from).getTime())) created.$gte = new Date(from);
  if (to && !Number.isNaN(new Date(to).getTime())) created.$lt = new Date(to);
  if (Object.keys(created).length > 0) and.push({ created_at: created });
  if (and.length > 0) filter.$and = and;

  const [total, rows] = await Promise.all([
    AuditLog.countDocuments(filter),
    AuditLog.find(filter).sort({ seq: -1 }).skip(clampOffset(offset)).limit(clampLimit(limit, 20, 100)).lean(),
  ]);
  return {
    total,
    rows: rows.map((entry) => ({ id: entry.seq, actor_id: entry.actor_id, action: entry.action, target_table: entry.target_table, target_id: entry.target_id, college_id: entry.college_id, metadata: entry.metadata ?? {}, created_at: iso(entry.created_at) })),
  };
}
