import "server-only";

// Events: who may manage them, who may see them, the eligibility rules and the
// one answer to "may this student take part right now?".

import { createHash, randomUUID } from "node:crypto";
import { ageOn } from "@/lib/dates";
import { isDuplicateKey } from "@/lib/db/connection";
import { College, Event, EVENT_STATUSES, EVENT_TYPES, Profile, ProfilePrivate } from "@/lib/db/models";
import { adminColleges, audit, currentCollegeId, deny, escapeRegex, fail, hasCollegePermission, isUuid, myProfile, plain, requireAdmin, requireSignedIn, ServiceError } from "./core";

// ----------------------------------------------------------------------------- eligibility rules
/** "B.Tech (Computer Science)" → ["btech", "computer", "science"] */
export function courseTokens(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** True when the rule's words appear, in order and as whole words, in the course ("MBA" does not match "BA"). */
export function courseMatches(course, rule) {
  const wanted = courseTokens(rule);
  if (wanted.length === 0) return false;
  return ` ${courseTokens(course).join(" ")} `.includes(` ${wanted.join(" ")} `);
}

const invalidRules = (detail) => fail("invalid_eligibility_rules", detail);

/**
 * Validates the eligibility document and returns its one canonical form:
 *   { colleges: { mode: "all" } | { mode: "selected", ids: [...sorted, host included] },
 *     courses: [...de-duplicated, sorted], study_years: [...sorted] }
 * Applied on every write, whatever sent it.
 */
export async function normalizeEligibilityRules(rules, hostCollegeId) {
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) invalidRules("rules must be an object");
  for (const key of Object.keys(rules)) if (!["colleges", "courses", "study_years"].includes(key)) invalidRules(`unknown key: ${key}`);

  let mode = "selected";
  let ids = [];
  const colleges = rules.colleges;
  if (colleges !== undefined && colleges !== null) {
    if (typeof colleges !== "object" || Array.isArray(colleges)) invalidRules("colleges must be an object");
    for (const key of Object.keys(colleges)) if (!["mode", "ids"].includes(key)) invalidRules(`unknown colleges key: ${key}`);
    mode = colleges.mode ?? "selected";
    if (!["all", "selected"].includes(mode)) invalidRules("colleges.mode must be all or selected");
    if (mode === "selected" && colleges.ids !== undefined) {
      if (!Array.isArray(colleges.ids) || colleges.ids.length > 100) invalidRules("colleges.ids must be an array of at most 100 ids");
      if (colleges.ids.some((id) => !isUuid(id))) invalidRules("colleges.ids must contain college ids");
      ids = colleges.ids.map((id) => id.toLowerCase());
    }
  }
  if (mode === "selected") {
    ids = [...new Set([...ids, hostCollegeId])].sort();
    const known = await College.countDocuments({ _id: { $in: ids } });
    if (known !== ids.length) fail("unknown_college_in_rules");
  }

  let courses = [];
  if (rules.courses !== undefined) {
    if (!Array.isArray(rules.courses) || rules.courses.length > 20) invalidRules("courses must be an array of at most 20 names");
    if (rules.courses.some((item) => typeof item !== "string")) invalidRules("courses must be text");
    const byLower = new Map();
    for (const name of rules.courses.map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean).sort()) {
      if (!byLower.has(name.toLowerCase())) byLower.set(name.toLowerCase(), name);
    }
    courses = [...byLower.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, name]) => name);
    if (courses.some((name) => name.length < 2 || name.length > 60 || /[<>\u0000-\u001f\u007f]/.test(name) || courseTokens(name).length === 0)) {
      invalidRules("each course must be 2 to 60 plain characters");
    }
  }

  let years = [];
  if (rules.study_years !== undefined) {
    if (!Array.isArray(rules.study_years)) invalidRules("study_years must be an array");
    if (rules.study_years.some((year) => !Number.isInteger(year) || year < 1 || year > 6)) invalidRules("study_years must be whole numbers from 1 to 6");
    years = [...new Set(rules.study_years)].sort((a, b) => a - b);
  }

  return { colleges: mode === "all" ? { mode: "all" } : { mode: "selected", ids }, courses, study_years: years };
}

/** Is a student of `collegeId` invited to this event? The host college always is. */
export async function eventInvitesCollege(event, collegeId, cache = null) {
  if (!collegeId) return false;
  if (collegeId === event.college_id) return true;
  const rule = event.eligibility_rules?.colleges ?? {};
  if (rule.mode === "all") {
    // `cache` (a Map) saves repeating this lookup when many students are checked for one event.
    if (cache?.has(collegeId)) return cache.get(collegeId);
    const open = Boolean(await College.exists({ _id: collegeId, is_active: true }));
    cache?.set(collegeId, open);
    return open;
  }
  return rule.mode === "selected" && Array.isArray(rule.ids) && rule.ids.includes(collegeId);
}

// ----------------------------------------------------------------------------- who may take part
/** Reasons that depend on the student. Used on its own to keep ineligible students out of discovery. */
export async function studentBlockers(event, userId, loaded = null, cache = null) {
  const profile = loaded?.profile ?? (await Profile.findById(userId).lean());
  if (!profile) return ["no_profile"];
  const dob = loaded ? loaded.dob : (await ProfilePrivate.findById(userId).select("date_of_birth").lean())?.date_of_birth;
  const rules = event.eligibility_rules ?? {};
  const blockers = [];
  if (profile.status !== "active") blockers.push("profile_suspended");
  if (!profile.avatar_path) blockers.push("photo_missing");
  if (!(await eventInvitesCollege(event, profile.college_id, cache))) blockers.push("college_not_invited");
  // Age on the day the event starts (calendar date in UTC).
  const age = dob ? ageOn(dob, new Date(event.starts_at)) : null;
  if (age === null || age < event.minimum_age) blockers.push("under_age");
  if ((rules.courses ?? []).length > 0 && !rules.courses.some((rule) => courseMatches(profile.course, rule))) blockers.push("course_not_eligible");
  if ((rules.study_years ?? []).length > 0 && !rules.study_years.includes(profile.study_year)) blockers.push("year_not_eligible");
  return blockers;
}

/** Reasons that depend on the event's status and dates. */
export function eventBlockers(event, now = new Date()) {
  if (event.status === "draft") return ["event_not_published"];
  if (event.status === "completed" || new Date(event.ends_at) <= now) return ["event_completed"];
  if (event.status === "closed") return ["event_closed"];
  if (event.registration_opens_at && new Date(event.registration_opens_at) > now) return ["registration_not_open"];
  if (event.registration_closes_at && new Date(event.registration_closes_at) <= now) return ["registration_closed"];
  return [];
}

/** Every reason this student cannot take part right now. Empty = they can. */
export async function participationBlockers(event, userId) {
  const student = await studentBlockers(event, userId);
  if (student.length === 1 && student[0] === "no_profile") return student;
  return [...student, ...eventBlockers(event)];
}

// ----------------------------------------------------------------------------- reading
const PUBLIC_FIELDS = "college_id title slug description event_type venue starts_at ends_at registration_opens_at registration_closes_at minimum_age eligibility_rules requirements status";
const ADMIN_FIELDS = `${PUBLIC_FIELDS} published_at created_at updated_at`; // never created_by

async function withColleges(events) {
  const colleges = await College.find({ _id: { $in: [...new Set(events.map((event) => event.college_id))] } }).select("name city").lean();
  const byId = new Map(colleges.map((college) => [college._id, { id: college._id, name: college.name, city: college.city }]));
  return plain(events.map((event) => ({ ...event, colleges: byId.get(event.college_id) ?? null })));
}

/** Filter for "non-draft events this caller may see": invited through their college, or hosted by a college whose events they manage. */
async function visibleToCaller(ctx) {
  const mine = await currentCollegeId(ctx);
  const managed = await adminColleges(ctx, ["manage_events"]);
  const reasons = [];
  if (managed.length > 0) reasons.push({ college_id: { $in: managed } });
  if (mine) {
    reasons.push({ college_id: mine }, { "eligibility_rules.colleges.ids": mine });
    if (await College.exists({ _id: mine, is_active: true })) reasons.push({ "eligibility_rules.colleges.mode": "all" });
  }
  return reasons.length > 0 ? { status: { $ne: "draft" }, $or: reasons } : null;
}

/** Events for the student pages: published, closed or completed, newest first. Drafts never appear here. */
export async function list_student_events(ctx, { limit = 200 } = {}) {
  requireSignedIn(ctx);
  const filter = await visibleToCaller(ctx);
  if (!filter) return [];
  const rows = await Event.find(filter).select(PUBLIC_FIELDS).sort({ starts_at: -1 }).limit(Math.min(Math.max(limit, 1), 500)).lean();
  return withColleges(rows);
}

/** One event by its URL slug, or null. "Does not exist" and "not for your college" look the same. */
export async function get_student_event(ctx, { slug }) {
  requireSignedIn(ctx);
  if (typeof slug !== "string") return null;
  const filter = await visibleToCaller(ctx);
  if (!filter) return null;
  const event = await Event.findOne({ ...filter, slug }).select(PUBLIC_FIELDS).lean();
  return event ? (await withColleges([event]))[0] : null;
}

/**
 * The event as a student may use it for partner finding: it exists, is not a
 * draft, and the caller's own (active) college is invited. Managing an event
 * does not make someone a participant.
 */
export async function visibleEvent(ctx, eventId) {
  const event = isUuid(eventId) ? await Event.findById(eventId).lean() : null;
  if (!event || event.status === "draft" || !(await eventInvitesCollege(event, await currentCollegeId(ctx)))) fail("event_not_found");
  return event;
}

/** Whether the caller may take part, worked out from their own stored profile. Nothing about the student is passed in. */
export async function event_participation_check(ctx, { p_event_id }) {
  const uid = requireSignedIn(ctx);
  const event = isUuid(p_event_id) ? await Event.findById(p_event_id).lean() : null;
  const canSee =
    event &&
    ((await hasCollegePermission(ctx, event.college_id, "manage_events")) ||
      (event.status !== "draft" && (await eventInvitesCollege(event, await currentCollegeId(ctx)))));
  if (!canSee) fail("event_not_found");
  const blockers = await participationBlockers(event, uid);
  return { can_participate: blockers.length === 0, blockers, is_verified: Boolean((await myProfile(ctx))?.is_verified) };
}

// ----------------------------------------------------------------------------- managing
/** The colleges whose events the caller may manage: [{ id, name, city, is_active }]. */
export async function manageable_colleges(ctx) {
  requireAdmin(ctx);
  const ids = await adminColleges(ctx, ["manage_events"]);
  const rows = await College.find({ _id: { $in: ids } }).select("name city is_active").sort({ name: 1 }).lean();
  return rows.map((college) => ({ id: college._id, name: college.name, city: college.city, is_active: college.is_active }));
}

export async function admin_list_events(ctx, { college = null, status = null, type = null, search = null, limit = 100 } = {}) {
  requireAdmin(ctx);
  const managed = await adminColleges(ctx, ["manage_events"]);
  if (college && !managed.includes(college)) return [];
  if (status && !EVENT_STATUSES.includes(status)) fail("invalid_request");
  if (type && !EVENT_TYPES.includes(type)) fail("invalid_request");
  const filter = { college_id: college ? college : { $in: managed } };
  if (status) filter.status = status;
  if (type) filter.event_type = type;
  const q = typeof search === "string" ? search.trim() : "";
  if (q) filter.title = { $regex: escapeRegex(q.slice(0, 80)), $options: "i" };
  const rows = await Event.find(filter).select("title event_type status starts_at ends_at created_at college_id").sort({ starts_at: -1 }).limit(Math.min(Math.max(limit, 1), 100)).lean();
  const full = await withColleges(rows);
  return full.map((event) => ({ ...event, colleges: event.colleges ? { name: event.colleges.name } : null }));
}

/** One event for an admin screen or action — only if the caller manages its host college. Otherwise null. */
export async function admin_get_event(ctx, { event_id }) {
  requireAdmin(ctx);
  const event = isUuid(event_id) ? await Event.findById(event_id).select(ADMIN_FIELDS).lean() : null;
  if (!event || !(await hasCollegePermission(ctx, event.college_id, "manage_events"))) return null;
  return (await withColleges([event]))[0];
}

const slugBase = (title) =>
  String(title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "") || "event";

const constraint = (name) => new ServiceError(name, { code: "23514" });

/** Reads and checks the editable fields. Status, slug, creator and publish time are never taken from a request. */
function readEventFields(row) {
  const text = (value, max) => {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string" || value.length > max) throw constraint("events_text_length");
    return value;
  };
  const date = (value, required) => {
    if (value === null || value === undefined || value === "") {
      if (required) throw constraint("events_dates_required");
      return null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw constraint("events_dates_required");
    return parsed;
  };
  const title = typeof row.title === "string" ? row.title.trim() : "";
  if (title.length < 3 || title.length > 140) throw constraint("events_title_length");
  if (!EVENT_TYPES.includes(row.event_type)) throw constraint("events_type_valid");
  const minimumAge = Number(row.minimum_age);
  if (!Number.isInteger(minimumAge) || minimumAge < 18 || minimumAge > 99) throw constraint("events_minimum_age_range");

  const fields = {
    title,
    event_type: row.event_type,
    description: text(row.description, 4000),
    venue: text(row.venue, 200),
    starts_at: date(row.starts_at, true),
    ends_at: date(row.ends_at, true),
    registration_opens_at: date(row.registration_opens_at, false),
    registration_closes_at: date(row.registration_closes_at, false),
    minimum_age: minimumAge,
    requirements: text(row.requirements, 2000),
  };
  if (fields.ends_at <= fields.starts_at) throw constraint("events_time_order");
  const { registration_opens_at: opens, registration_closes_at: closes } = fields;
  if (opens && closes && closes <= opens) throw constraint("events_registration_order");
  if ((opens && opens >= fields.ends_at) || (closes && closes > fields.ends_at)) throw constraint("events_registration_within_event");
  return fields;
}

const auditEvent = (event) => ({ status: event.status, title: event.title });

/** Creates a draft. The host college must be open and managed by the caller. */
export async function admin_create_event(ctx, { college_id, ...row }) {
  const uid = requireAdmin(ctx);
  if (!(await hasCollegePermission(ctx, college_id, "manage_events"))) deny();
  if (!(await College.exists({ _id: college_id, is_active: true }))) fail("invalid_college");
  const fields = readEventFields(row);
  const rules = await normalizeEligibilityRules(row.eligibility_rules, college_id);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = `${slugBase(fields.title)}-${createHash("md5").update(randomUUID()).digest("hex").slice(0, 6)}`;
    try {
      const event = await Event.create({ ...fields, college_id, slug, eligibility_rules: rules, status: "draft", published_at: null, created_by: uid });
      await audit(ctx, "events.insert", "events", event._id, college_id, { new: auditEvent(event) });
      return event._id;
    } catch (error) {
      if (!isDuplicateKey(error, "slug")) throw error;
    }
  }
  throw new Error("could not allocate an event slug");
}

/** Saves edits. A completed event is frozen. Returns false if the caller has no access to the event. */
export async function admin_update_event(ctx, { event_id, row }) {
  requireAdmin(ctx);
  const event = isUuid(event_id) ? await Event.findById(event_id).lean() : null;
  if (!event || !(await hasCollegePermission(ctx, event.college_id, "manage_events"))) return false;
  if (event.status === "completed") fail("event_completed_locked");
  const fields = readEventFields(row);
  const rules = await normalizeEligibilityRules(row.eligibility_rules, event.college_id);
  const saved = await Event.updateOne({ _id: event._id, status: { $ne: "completed" } }, { $set: { ...fields, eligibility_rules: rules } });
  if (saved.matchedCount !== 1) fail("event_completed_locked");
  return true;
}

const TRANSITIONS = { draft: ["published"], published: ["closed", "completed"], closed: ["published", "completed"], completed: [] };

/**
 * draft → published → closed ⇄ published → completed. Publishing needs a
 * description, a venue and an end time in the future.
 * Returns false when the event is no longer in the status the caller saw.
 */
export async function admin_change_event_status(ctx, { event_id, from, to }) {
  requireAdmin(ctx);
  const event = isUuid(event_id) ? await Event.findById(event_id).lean() : null;
  if (!event || !(await hasCollegePermission(ctx, event.college_id, "manage_events"))) fail("event_not_found");
  if (event.status === "completed") fail("event_completed_locked");
  if (!EVENT_STATUSES.includes(to) || !TRANSITIONS[event.status].includes(to)) fail("invalid_status_transition", `${event.status} -> ${to}`);
  if (from && from !== event.status) return false;

  const changes = { status: to };
  if (to === "published") {
    if (new Date(event.ends_at) <= new Date()) fail("event_already_ended");
    if (!String(event.description ?? "").trim() || !String(event.venue ?? "").trim()) fail("event_incomplete");
    changes.published_at = event.published_at ?? new Date(); // kept when an event is re-opened
  }
  const changed = await Event.updateOne({ _id: event._id, status: event.status }, { $set: changes });
  if (changed.modifiedCount !== 1) return false; // someone else changed it in the meantime
  await audit(ctx, "events.update", "events", event._id, event.college_id, { old: auditEvent(event), new: { status: to, title: event.title } });
  return true;
}
