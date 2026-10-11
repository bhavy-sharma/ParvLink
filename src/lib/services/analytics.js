import "server-only";

// Numbers for the admin screens. Aggregates only — no ids, names or message
// text — and always limited to the colleges and permissions of the caller.
// Definitions (kept identical to what the screens explain):
//   * a match is ONE row per pair per event — two matched students are 1 match;
//   * participations are one per student per event;
//   * "active discovery" = profile open, account active, event accepting participants;
//   * drafts are never counted, except for the admins who manage them.

import { AccountModeration, College, Event, EVENT_STATUSES, EventParticipant, Interest, Match, Profile, Report, User } from "@/lib/db/models";
import { adminColleges, clampLimit, clampOffset, countBy, deny, escapeRegex, fail, isSuperAdmin, requireAdmin } from "./core";
import { eventBlockers } from "./events";
import { dayBounds, periodFilter } from "./moderation";

const iso = (date) => (date ? new Date(date).toISOString() : null);

/** Participation numbers for a set of events (all non-draft events of some colleges, or one page of events). */
async function participationNumbers(events, period = null) {
  const ids = events.map((event) => event._id);
  if (ids.length === 0) return { participations: 0, participants: 0, active_discovery: 0, in_period: 0, perEvent: new Map() };
  const acceptingNow = new Set(events.filter((event) => eventBlockers(event).length === 0).map((event) => event._id));
  const rows = await EventParticipant.find({ event_id: { $in: ids } }).select("event_id user_id status created_at").lean();
  const activeProfiles = new Set(
    (await Profile.find({ _id: { $in: [...new Set(rows.map((row) => row.user_id))] }, status: "active" }).select("_id").lean()).map((row) => row._id),
  );
  const perEvent = new Map(ids.map((id) => [id, { participants: 0, active_discovery: 0 }]));
  let active = 0;
  let inPeriod = 0;
  for (const row of rows) {
    const entry = perEvent.get(row.event_id);
    entry.participants += 1;
    if (row.status === "active" && activeProfiles.has(row.user_id) && acceptingNow.has(row.event_id)) {
      entry.active_discovery += 1;
      active += 1;
    }
    if (period && (!period.from || row.created_at >= period.from) && (!period.to || row.created_at < period.to)) inPeriod += 1;
  }
  return { participations: rows.length, participants: new Set(rows.map((row) => row.user_id)).size, active_discovery: active, in_period: inPeriod, perEvent };
}

/** The admin overview. Blocks the caller's permissions do not cover are simply absent. */
export async function admin_overview_stats(ctx, { p_college = null, p_from = null, p_to = null, p_tz = "Asia/Kolkata" } = {}) {
  requireAdmin(ctx);
  let any = await adminColleges(ctx, null);
  let students = await adminColleges(ctx, ["view_students", "manage_students"]);
  let reports = await adminColleges(ctx, ["moderate_reports"]);
  const period = dayBounds(p_from, p_to, p_tz);
  if (p_college) {
    // A college in the request can only narrow the scope.
    if (!any.includes(p_college)) deny();
    students = students.includes(p_college) ? [p_college] : [];
    reports = reports.includes(p_college) ? [p_college] : [];
    any = [p_college];
  }
  const now = new Date();
  const inPeriod = (field) => periodFilter(field, period);
  const events = await Event.find({ college_id: { $in: any }, status: { $ne: "draft" } }).select("status starts_at ends_at registration_opens_at registration_closes_at").lean();
  const eventIds = events.map((event) => event._id);
  const live = events.filter((event) => ["published", "closed"].includes(event.status));
  const participation = await participationNumbers(events, period);

  const out = {
    generated_at: now.toISOString(),
    has_period: Boolean(period.from || period.to),
    colleges: { total: await College.countDocuments({ _id: { $in: any } }), open: await College.countDocuments({ _id: { $in: any }, is_active: true }) },
    events: {
      published: events.filter((event) => event.status === "published").length,
      closed: events.filter((event) => event.status === "closed").length,
      completed: events.filter((event) => event.status === "completed").length,
      upcoming: live.filter((event) => event.starts_at > now).length,
      ongoing: live.filter((event) => event.starts_at <= now && event.ends_at > now).length,
      ended_unmarked: live.filter((event) => event.ends_at <= now).length,
    },
    participation: { participations: participation.participations, participants: participation.participants, active_discovery: participation.active_discovery, in_period: participation.in_period },
    interests: {
      total: await Interest.countDocuments({ event_id: { $in: eventIds } }),
      in_period: await Interest.countDocuments({ event_id: { $in: eventIds }, ...inPeriod("created_at") }),
    },
    matches: {
      total: await Match.countDocuments({ event_id: { $in: eventIds } }),
      in_period: await Match.countDocuments({ event_id: { $in: eventIds }, ...inPeriod("created_at") }),
    },
  };

  if (students.length > 0) {
    const scope = { college_id: { $in: students } };
    const ids = (await Profile.find(scope).select("_id").lean()).map((row) => row._id);
    out.students = {
      total: ids.length,
      active: await Profile.countDocuments({ ...scope, status: "active" }),
      suspended: await Profile.countDocuments({ ...scope, status: "suspended" }),
      under_review: await AccountModeration.countDocuments({ _id: { $in: ids }, under_review: true }),
      in_period: await Profile.countDocuments({ ...scope, ...inPeriod("created_at") }),
    };
  }
  if (reports.length > 0) {
    const scope = { college_id: { $in: reports } };
    out.reports = {
      submitted: await Report.countDocuments(scope),
      pending: await Report.countDocuments({ ...scope, status: "open" }),
      in_review: await Report.countDocuments({ ...scope, status: "in_review" }),
      resolved: await Report.countDocuments({ ...scope, status: "resolved" }),
      dismissed: await Report.countDocuments({ ...scope, status: "dismissed" }),
      in_period: await Report.countDocuments({ ...scope, ...inPeriod("created_at") }),
    };
  }
  if (isSuperAdmin(ctx) && !p_college) {
    const registered = await User.countDocuments({});
    out.accounts = {
      registered,
      email_confirmed: await User.countDocuments({ email_confirmed_at: { $ne: null } }),
      without_profile: registered - (await Profile.countDocuments({})),
    };
  }
  return out;
}

/** One row per college in the caller's scope. Student and report columns are null where the permission is missing. */
export async function admin_college_stats(ctx, { p_from = null, p_to = null, p_tz = "Asia/Kolkata" } = {}) {
  requireAdmin(ctx);
  const any = await adminColleges(ctx, null);
  const students = await adminColleges(ctx, ["view_students", "manage_students"]);
  const reports = await adminColleges(ctx, ["moderate_reports"]);
  const period = dayBounds(p_from, p_to, p_tz);
  const inPeriod = periodFilter("created_at", period);

  const colleges = await College.find({ _id: { $in: any } }).select("name is_active").sort({ name: 1 }).lean();
  const rows = [];
  for (const college of colleges) {
    const events = await Event.find({ college_id: college._id }).select("status starts_at ends_at registration_opens_at registration_closes_at").lean();
    const eventIds = events.map((event) => event._id);
    const participation = await participationNumbers(events, period);
    const seesStudents = students.includes(college._id);
    const seesReports = reports.includes(college._id);
    rows.push({
      college_id: college._id,
      college_name: college.name,
      is_active: college.is_active,
      students: seesStudents ? await Profile.countDocuments({ college_id: college._id }) : null,
      students_active: seesStudents ? await Profile.countDocuments({ college_id: college._id, status: "active" }) : null,
      students_suspended: seesStudents ? await Profile.countDocuments({ college_id: college._id, status: "suspended" }) : null,
      events_published: events.filter((event) => event.status === "published").length,
      events_completed: events.filter((event) => event.status === "completed").length,
      participations: participation.in_period,
      active_discovery: participation.active_discovery,
      interests: await Interest.countDocuments({ event_id: { $in: eventIds }, ...inPeriod }),
      matches: await Match.countDocuments({ event_id: { $in: eventIds }, ...inPeriod }),
      reports_submitted: seesReports ? await Report.countDocuments({ college_id: college._id, ...inPeriod }) : null,
      reports_closed: seesReports ? await Report.countDocuments({ college_id: college._id, status: { $in: ["resolved", "dismissed"] }, ...inPeriod }) : null,
    });
  }
  return rows;
}

/** A page of events with their numbers. Drafts only for the admins who manage that college's events. */
export async function admin_event_stats(ctx, { p_college = null, p_status = null, p_search = null, p_event = null, p_limit = 20, p_offset = 0 } = {}) {
  requireAdmin(ctx);
  const any = await adminColleges(ctx, null);
  const manage = await adminColleges(ctx, ["manage_events"]);
  const reports = await adminColleges(ctx, ["moderate_reports"]);
  if (p_status && !EVENT_STATUSES.includes(p_status)) fail("invalid_request");

  const and = [{ college_id: { $in: any } }, { $or: [{ status: { $ne: "draft" } }, { college_id: { $in: manage } }] }];
  if (p_college) and.push({ college_id: p_college });
  if (p_status) and.push({ status: p_status });
  if (p_event) and.push({ _id: p_event });
  const q = typeof p_search === "string" ? p_search.trim() : "";
  if (q) and.push({ title: { $regex: escapeRegex(q.slice(0, 80)), $options: "i" } });
  const filter = { $and: and };

  const [total, events] = await Promise.all([
    Event.countDocuments(filter),
    Event.find(filter).sort({ starts_at: -1, _id: 1 }).skip(clampOffset(p_offset)).limit(clampLimit(p_limit, 20, 100))
      .select("title college_id status starts_at ends_at registration_opens_at registration_closes_at").lean(),
  ]);
  const ids = events.map((event) => event._id);
  const [colleges, participation, interests, matches, matchRows, reportCounts] = await Promise.all([
    College.find({ _id: { $in: events.map((event) => event.college_id) } }).select("name").lean(),
    participationNumbers(events),
    countBy(Interest, "event_id", ids),
    countBy(Match, "event_id", ids),
    Match.find({ event_id: { $in: ids } }).select("event_id user_a_id user_b_id").lean(),
    countBy(Report, "event_id", ids, { college_id: { $in: reports } }),
  ]);
  const collegeOf = new Map(colleges.map((row) => [row._id, row.name]));
  const matchedPeople = new Map(ids.map((id) => [id, new Set()]));
  for (const match of matchRows) matchedPeople.get(match.event_id).add(match.user_a_id).add(match.user_b_id);

  return events.map((event) => ({
    event_id: event._id,
    title: event.title,
    college_id: event.college_id,
    college_name: collegeOf.get(event.college_id) ?? null,
    status: event.status,
    starts_at: iso(event.starts_at),
    ends_at: iso(event.ends_at),
    participants: participation.perEvent.get(event._id)?.participants ?? 0,
    active_discovery: participation.perEvent.get(event._id)?.active_discovery ?? 0,
    interests: interests.get(event._id) ?? 0,
    matches: matches.get(event._id) ?? 0, // pairs, not people
    matched_participants: matchedPeople.get(event._id).size,
    reports: reports.includes(event.college_id) ? (reportCounts.get(event._id) ?? 0) : null,
    total,
  }));
}
