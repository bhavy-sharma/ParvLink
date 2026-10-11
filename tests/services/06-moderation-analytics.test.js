// Moderation (reports, evidence, account actions, audit log) and analytics: scope, workflow and exact numbers.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createWorld, errorOf, handleOf, makeAdmin, makeEvent, makeStudent, match, models, ok, refused, testDatabase } from "./helpers";

const { AuditLog, Message, Match, Profile, Report } = models;
const db = testDatabase("moderation");
let c;
let u;
let eventA; // hosted by A, open to A and B
let reportA; // profile report: a1 → a2 (college A)
let reportB; // profile report: a1 → b1 (college B)
let chatReport; // chat report with messages: a3's partner → a3 (college A)
let chatPartner;

const NOTE = "Looked at the profile and spoke to the student.";
const reportBy = (reporter) => Report.findOne({ reporter_id: reporter }).sort({ created_at: -1 }).lean();
const actions = async (targetId) => (await AuditLog.find({ target_id: targetId }).sort({ seq: 1 }).lean()).map((entry) => entry.action);

beforeAll(async () => {
  await db.start();
  ({ c, u } = await createWorld());
  eventA = await makeEvent(c.a, { title: "Spring Fest", eligibility_rules: { colleges: { mode: "selected", ids: [c.a, c.b] }, courses: [], study_years: [] } });
  await ok(u.a1, "join_event", { p_event_id: eventA, p_looking_for: "female" });
  await ok(u.a2, "join_event", { p_event_id: eventA, p_looking_for: "male" });
  await ok(u.b1, "join_event", { p_event_id: eventA, p_looking_for: "male" });
  await ok(u.a1, "report_partner", { p_event_id: eventA, p_handle: await handleOf(eventA, u.a2), p_reason: "spam", p_details: "Sends the same line to everyone." });
  reportA = (await reportBy(u.a1))._id;
  await ok(u.a1, "report_partner", { p_event_id: eventA, p_handle: await handleOf(eventA, u.b1), p_reason: "fake_profile" });
  reportB = (await Report.findOne({ reported_user_id: u.b1 }).lean())._id;

  chatPartner = await makeStudent(c.a, { firstName: "Kabir", gender: "male" });
  const { conversation, matchId } = await match(eventA, chatPartner, u.a3);
  await Message.insertMany([1, 2, 3].map((seq) => ({ match_id: matchId, sender_id: seq === 2 ? chatPartner : u.a3, body: `secret line ${seq}`, client_id: randomUUID(), seq })));
  await Match.updateOne({ _id: matchId }, { $set: { last_seq: 3 } });
  await ok(chatPartner, "report_chat_partner", { p_conversation: conversation, p_reason: "harassment", p_include_messages: true });
  chatReport = (await reportBy(chatPartner))._id;
});
afterAll(() => db.stop());

describe("who sees which reports", () => {
  test("only admins with moderate_reports, only for their colleges; a college in the request cannot widen that", async () => {
    const refs = async (who, args) => (await ok(who, "admin_list_reports", args)).map((row) => row.report_id).sort();
    expect(await refs(u.superAdmin)).toEqual([reportA, reportB, chatReport].sort());
    expect(await refs(u.adminA)).toEqual([reportA, chatReport].sort());
    expect(await refs(u.modA)).toEqual([reportA, chatReport].sort());
    expect(await refs(u.viewerA)).toEqual([]);
    expect(await refs(u.eventsB)).toEqual([]);
    expect(await refs(u.adminNone)).toEqual([]);
    expect(await refs(u.modA, { p_college: c.b })).toEqual([]);
    expect(await refs(u.modA, { p_college: { $ne: null } })).toEqual([]);
    for (const student of [u.a1, u.a2, u.newcomer]) expect(await refused(student, "admin_list_reports")).toBe("not_authorized");
    expect(await refused(null, "admin_list_reports")).toBe("not_authenticated");

    for (const who of [u.viewerA, u.eventsB, u.adminNone, u.a1]) {
      for (const name of ["admin_get_report", "admin_view_report_evidence"]) expect(await refused(who, name, { p_report: reportA })).not.toBeNull();
      expect(await refused(who, "admin_set_report_status", { p_report: reportA, p_status: "in_review" })).not.toBeNull();
      expect(await refused(who, "admin_add_report_note", { p_report: reportA, p_body: "hello" })).not.toBeNull();
      expect(await refused(who, "admin_assign_report", { p_report: reportA, p_assign: true })).not.toBeNull();
    }
    // Another college's report and a report that does not exist give the same answer.
    expect(await refused(u.modA, "admin_get_report", { p_report: reportB })).toBe("report_not_found");
    expect(await refused(u.modA, "admin_get_report", { p_report: randomUUID() })).toBe("report_not_found");
    expect(await refused(u.modA, "admin_get_report", { p_report: "x" })).toBe("report_not_found");
  });

  test("filters, search and paging", async () => {
    const list = (args) => ok(u.superAdmin, "admin_list_reports", args);
    expect((await list({ p_reason: "spam" })).map((row) => row.report_id)).toEqual([reportA]);
    expect((await list({ p_status: "open" }))).toHaveLength(3);
    expect(await list({ p_status: "resolved" })).toEqual([]);
    expect((await list({ p_college: c.b })).map((row) => row.report_id)).toEqual([reportB]);
    expect((await list({ p_event: eventA }))).toHaveLength(3);
    expect((await list({ p_search: "bel" })).map((row) => row.reported_name)).toEqual(["Bela"]);
    expect((await list({ p_search: `R-${reportB.slice(0, 8)}` })).map((row) => row.report_id)).toEqual([reportB]);
    expect(await list({ p_search: ".*" })).toEqual([]); // a pattern is searched for as text
    expect(await list({ p_assigned: "me" })).toEqual([]);
    expect(await list({ p_assigned: "none" })).toHaveLength(3);
    const today = new Date().toISOString().slice(0, 10);
    expect(await list({ p_from: today, p_to: today, p_tz: "UTC" })).toHaveLength(3);
    expect(await list({ p_from: "2020-01-01", p_to: "2020-01-31" })).toEqual([]);
    expect(await refused(u.superAdmin, "admin_list_reports", { p_from: "2026-02-01", p_to: "2026-01-01" })).toBe("invalid_date_range");
    expect(await refused(u.superAdmin, "admin_list_reports", { p_status: "deleted" })).toBe("invalid_request");
    const page = await list({ p_limit: 2, p_offset: 2 });
    expect(page).toHaveLength(1);
    expect(page[0].total).toBe(3);
    // The list never carries what the reporter wrote or attached.
    expect(JSON.stringify(await list())).not.toMatch(/secret line|same line to everyone|"details"|"evidence"/);
    expect((await list()).find((row) => row.report_id === chatReport)).toMatchObject({ kind: "chat", has_evidence: true });
    expect((await ok(u.modA, "admin_report_events")).map((row) => row.title)).toEqual(["Spring Fest"]);
    expect(await ok(u.viewerA, "admin_report_events")).toEqual([]);
  });

  test("an admin never handles a report they filed or that is about them — Super Admin included", async () => {
    const adminStudent = await makeStudent(c.a, { firstName: "Leela", gender: "female", role: "admin" });
    await models.AdminCollegeAccess.create({ admin_user_id: adminStudent, college_id: c.a, permissions: ["moderate_reports", "view_students"] });
    const about = (await Report.create({ reporter_id: u.a1, reported_user_id: adminStudent, college_id: c.a, reason: "spam", open_key: randomUUID() }))._id;
    const filed = (await Report.create({ reporter_id: adminStudent, reported_user_id: u.a2, college_id: c.a, reason: "spam", open_key: randomUUID() }))._id;
    const mine = (await ok(adminStudent, "admin_list_reports")).map((row) => row.report_id);
    expect(mine).not.toContain(about);
    expect(mine).not.toContain(filed);
    expect(mine).toContain(reportA);
    for (const id of [about, filed]) {
      expect(await refused(adminStudent, "admin_get_report", { p_report: id })).toBe("report_not_found");
      expect(await refused(adminStudent, "admin_set_report_status", { p_report: id, p_status: "dismissed", p_note: NOTE })).toBe("report_not_found");
    }
    // Her own student record does not show her the reports about her either.
    expect((await ok(adminStudent, "admin_get_user", { p_user: adminStudent })).reports).toBeNull();
    expect((await ok(adminStudent, "admin_list_users", { p_search: "Leela" }))[0].open_reports).toBeNull();
    await Report.deleteMany({ _id: { $in: [about, filed] } });
  });
});

describe("one report", () => {
  test("detail shows what a moderator needs, and nothing private", async () => {
    const detail = await ok(u.modA, "admin_get_report", { p_report: reportA });
    expect(detail.report).toMatchObject({ id: reportA, reason: "spam", details: "Sends the same line to everyone.", status: "open", kind: "profile", evidence_count: 0 });
    expect(detail.reported).toMatchObject({ first_name: "Bela", status: "active", can_view: false, can_moderate: false, is_staff: false });
    expect(detail.reporter).toMatchObject({ first_name: "Arjun" });
    expect(detail.event).toMatchObject({ title: "Spring Fest" });
    expect((await ok(u.adminA, "admin_get_report", { p_report: reportA })).reported).toMatchObject({ can_view: true, can_moderate: true });
    expect(JSON.stringify(detail)).not.toMatch(/email|date_of_birth|gender|password|secret line/);
  });

  test("attached messages need a separate request, and every look is logged first", async () => {
    const detail = await ok(u.modA, "admin_get_report", { p_report: chatReport });
    expect(detail.report).toMatchObject({ kind: "chat", evidence_count: 3 });
    expect(JSON.stringify(detail)).not.toContain("secret line");
    expect(await actions(chatReport)).toEqual([]);

    const evidence = await ok(u.modA, "admin_view_report_evidence", { p_report: chatReport });
    expect(evidence.map((line) => [line.seq, line.from, line.body])).toEqual([[1, "reported", "secret line 1"], [2, "reporter", "secret line 2"], [3, "reported", "secret line 3"]]);
    await ok(u.superAdmin, "admin_view_report_evidence", { p_report: chatReport });
    const log = await AuditLog.find({ target_id: chatReport }).sort({ seq: 1 }).lean();
    expect(log.map((entry) => [entry.action, entry.actor_id, entry.metadata.messages])).toEqual([["reports.evidence_viewed", u.modA, 3], ["reports.evidence_viewed", u.superAdmin, 3]]);
    expect(JSON.stringify(log)).not.toContain("secret line"); // the log records the look, never the text

    expect(await ok(u.modA, "admin_view_report_evidence", { p_report: reportA })).toEqual([]); // nothing attached: nothing logged
    expect(await actions(reportA)).toEqual([]);
    expect(await refused(u.viewerA, "admin_view_report_evidence", { p_report: chatReport })).toBe("report_not_found");
    expect(await AuditLog.countDocuments({ target_id: chatReport })).toBe(2);
  });

  test("workflow: reasons required to close and re-open; what the student wrote never changes", async () => {
    const before = await Report.findById(reportA).lean();
    const set = (status, note, who = u.modA) => refused(who, "admin_set_report_status", { p_report: reportA, p_status: status, p_note: note });

    expect(await set("open")).toBe("invalid_report_transition");
    expect(await set("archived")).toBe("invalid_request");
    expect(await set("resolved")).toBe("decision_note_required");
    expect(await set("resolved", "too short")).toBe("decision_note_required");
    expect(await set("resolved", "x".repeat(1001))).toBe("decision_note_too_long");
    expect(await set("in_review")).toBeNull();
    expect(await Report.findById(reportA).lean()).toMatchObject({ status: "in_review", assigned_to: u.modA });
    expect(await set("open")).toBeNull();
    expect(await set("resolved", NOTE)).toBeNull();
    const closed = await Report.findById(reportA).lean();
    expect(closed).toMatchObject({ status: "resolved", resolved_by: u.modA, resolution_note: NOTE });
    expect(closed.resolved_at).toBeInstanceOf(Date);
    expect(await set("dismissed", NOTE)).toBe("invalid_report_transition");
    expect(await set("open", NOTE)).toBe("invalid_report_transition");
    expect(await set("in_review")).toBe("decision_note_required");
    expect(await set("in_review", "New information from the student's college.")).toBeNull();
    const reopened = await Report.findById(reportA).lean();
    expect(reopened).toMatchObject({ status: "in_review", resolved_at: null, resolved_by: null, resolution_note: null });
    for (const field of ["reporter_id", "reported_user_id", "college_id", "event_id", "reason", "details", "created_at"]) expect(reopened[field]).toEqual(before[field]);

    expect(await actions(reportA)).toEqual(Array(4).fill("reports.status_changed"));
    const history = (await ok(u.modA, "admin_get_report", { p_report: reportA })).history;
    expect(history.map((entry) => [entry.from, entry.to])).toEqual([["open", "in_review"], ["in_review", "open"], ["open", "resolved"], ["resolved", "in_review"]]);
    expect(history[2].note).toBe(NOTE);
  });

  test("two moderators deciding at once: one decision", async () => {
    const id = (await Report.create({ reporter_id: u.a1, reported_user_id: u.a3, college_id: c.a, reason: "spam", open_key: randomUUID() }))._id;
    const results = await Promise.all([
      refused(u.modA, "admin_set_report_status", { p_report: id, p_status: "resolved", p_note: NOTE }),
      refused(u.adminA, "admin_set_report_status", { p_report: id, p_status: "dismissed", p_note: NOTE }),
    ]);
    expect(results.filter((result) => result === null)).toHaveLength(1);
    expect(results.filter((result) => result === "invalid_report_transition")).toHaveLength(1);
    expect(await AuditLog.countDocuments({ target_id: id })).toBe(1);
    await Report.deleteOne({ _id: id });
  });

  test("assignment and notes", async () => {
    const assign = (who, value) => refused(who, "admin_assign_report", { p_report: chatReport, p_assign: value });
    expect(await assign(u.modA, "yes")).toBe("invalid_request");
    expect(await assign(u.modA, true)).toBeNull();
    expect(await assign(u.modA, true)).toBeNull(); // already mine: nothing happens
    expect(await assign(u.adminA, false)).toBe("not_authorized"); // only the assignee or a Super Admin unassigns
    expect(await assign(u.adminA, true)).toBeNull(); // taking over is allowed, and recorded as such
    expect(await assign(u.superAdmin, false)).toBeNull();
    const log = (await AuditLog.find({ target_id: chatReport, action: /assigned/ }).sort({ seq: 1 }).lean()).map((entry) => [entry.action, entry.actor_id, entry.metadata.took_over ?? null]);
    expect(log).toEqual([["reports.assigned", u.modA, false], ["reports.assigned", u.adminA, true], ["reports.unassigned", u.superAdmin, null]]);

    expect(await refused(u.modA, "admin_add_report_note", { p_report: chatReport, p_body: "   " })).toBe("note_empty");
    expect(await refused(u.modA, "admin_add_report_note", { p_report: chatReport, p_body: "x".repeat(2001) })).toBe("note_too_long");
    await ok(u.modA, "admin_add_report_note", { p_report: chatReport, p_body: "Called the college office about this." });
    const detail = await ok(u.adminA, "admin_get_report", { p_report: chatReport });
    expect(detail.notes).toMatchObject([{ body: "Called the college office about this." }]);
    const entry = await AuditLog.findOne({ target_id: chatReport, action: "reports.note_added" }).lean();
    expect(entry.metadata).toMatchObject({ length: 37 });
    expect(JSON.stringify(entry)).not.toContain("college office");
  });
});

describe("students and account moderation", () => {
  test("the student list: scoped, approved fields only, report counts only for moderators", async () => {
    const list = (who, args) => ok(who, "admin_list_users", args);
    const viewer = await list(u.viewerA);
    expect(viewer.every((row) => row.college_id === c.a)).toBe(true);
    expect(viewer.every((row) => row.open_reports === null)).toBe(true);
    expect(Object.keys(viewer[0]).sort()).toEqual(["college_id", "college_name", "course", "first_name", "joined_at", "open_reports", "ref", "status", "study_year", "suspended_until", "total", "under_review", "user_id"]);
    expect((await list(u.adminA, { p_search: "kab" }))[0]).toMatchObject({ first_name: "Kabir", open_reports: 0 });
    expect((await list(u.adminA, { p_search: "chit" }))[0]).toMatchObject({ first_name: "Chitra", open_reports: 1 });
    expect(await list(u.modA)).toEqual([]); // moderating reports is not permission to browse students
    expect(await list(u.eventsB)).toEqual([]);
    expect(await list(u.viewerA, { p_college: c.b })).toEqual([]);
    expect((await list(u.superAdmin, { p_college: c.b })).map((row) => row.first_name)).toEqual(["Divya"]);
    expect((await list(u.viewerA, { p_status: "suspended" })).map((row) => row.first_name)).toEqual(["Sam"]);
    expect((await list(u.viewerA, { p_search: `u-${u.a1.slice(0, 8)}` })).map((row) => row.first_name)).toEqual(["Arjun"]);
    expect(await list(u.viewerA, { p_search: "(" })).toEqual([]);
    expect(await refused(u.viewerA, "admin_list_users", { p_status: "deleted" })).toBe("invalid_request");
    expect(await refused(u.a1, "admin_list_users")).toBe("not_authorized");

    const one = await ok(u.viewerA, "admin_get_user", { p_user: u.a1 });
    expect(one.user).toMatchObject({ first_name: "Arjun", status: "active", is_staff: false });
    expect(one.can_moderate).toBe(false);
    expect(one.reports).toBeNull();
    expect(one.participation).toMatchObject({ events_joined: 1, interests_sent: 0, matches: 0 });
    expect(JSON.stringify(one)).not.toMatch(/email|date_of_birth|gender|password|secret line/);
    expect((await ok(u.adminA, "admin_get_user", { p_user: u.a3 })).reports).toMatchObject({ against_open: 1 });
    expect(await refused(u.viewerA, "admin_get_user", { p_user: u.b1 })).toBe("student_not_found");
    expect(await refused(u.viewerA, "admin_get_user", { p_user: randomUUID() })).toBe("student_not_found");
    expect(await refused(u.modA, "admin_get_user", { p_user: u.a1 })).toBe("student_not_found");
  });

  test("flag, suspend and restore: permission, reasons, logging, and the effect on every partner service", async () => {
    const target = await makeStudent(c.a, { firstName: "Meera", gender: "female" });
    const act = (who, action, extra = {}) => refused(who, "admin_moderate_user", { p_user: target, p_action: action, ...extra });
    const REASON = "Repeated harassment reported by three students.";

    for (const who of [u.viewerA, u.modA, u.eventsB, u.adminNone]) expect(await act(who, "suspend", { p_reason: REASON })).toBe("student_not_found");
    expect(await act(u.a1, "suspend", { p_reason: REASON })).toBe("not_authorized");
    expect(await act(u.adminA, "delete")).toBe("invalid_request");
    expect(await act(u.adminA, "suspend")).toBe("moderation_reason_required");
    expect(await act(u.adminA, "suspend", { p_reason: "short" })).toBe("moderation_reason_required");
    expect(await act(u.adminA, "suspend", { p_reason: "x".repeat(501) })).toBe("moderation_reason_too_long");
    expect(await act(u.adminA, "suspend", { p_reason: REASON, p_days: 0 })).toBe("invalid_request");
    expect(await act(u.adminA, "suspend", { p_reason: REASON, p_days: 400 })).toBe("invalid_request");
    expect(await act(u.adminA, "suspend", { p_reason: REASON, p_report: reportB })).toBe("invalid_request"); // a report about someone else
    expect(await act(u.adminA, "restore")).toBe("not_suspended");
    expect(await act(u.adminA, "clear_review")).toBe("not_under_review");
    expect((await Profile.findById(target).lean()).status).toBe("active");

    expect(await act(u.adminA, "flag_review", { p_reason: REASON })).toBeNull();
    expect(await act(u.adminA, "flag_review", { p_reason: REASON })).toBe("already_under_review");
    expect((await ok(u.viewerA, "admin_list_users", { p_status: "under_review" })).map((row) => row.first_name)).toEqual(["Meera"]);
    expect(await ok(target, "my_account_status")).toEqual({ status: "active", suspended_until: null }); // a flag is internal
    expect(await act(u.adminA, "clear_review")).toBeNull();

    const event = await makeEvent(c.a);
    const { conversation } = await match(event, u.a1, target);
    const result = await ok(u.adminA, "admin_moderate_user", { p_user: target, p_action: "suspend", p_reason: REASON, p_days: 7 });
    expect(new Date(result.until).getTime()).toBeGreaterThan(Date.now() + 6.9 * 86400000);
    expect(await act(u.adminA, "suspend", { p_reason: REASON })).toBe("already_suspended");
    expect(await refused(target, "discover_event_partners", { p_event_id: event })).toBe("account_suspended");
    expect(await refused(target, "chat_send", { p_conversation: conversation, p_body: "hi", p_client_id: randomUUID() })).toBe("account_suspended");
    expect(await ok(u.a1, "discover_event_partners", { p_event_id: event })).toEqual([]);
    expect(await refused(u.a1, "chat_send", { p_conversation: conversation, p_body: "hi", p_client_id: randomUUID() })).toBe("messaging_unavailable");
    const standing = await ok(target, "my_account_status");
    expect(standing.status).toBe("suspended");
    expect(Object.keys(standing).sort()).toEqual(["status", "suspended_until"]); // never the reason or who did it

    expect(await act(u.adminA, "restore")).toBeNull();
    expect(await refused(target, "chat_send", { p_conversation: conversation, p_body: "hi", p_client_id: randomUUID() })).toBeNull();
    const log = await AuditLog.find({ target_id: target }).sort({ seq: 1 }).lean();
    expect(log.map((entry) => entry.action)).toEqual(["profiles.flag_review", "profiles.clear_review", "profiles.suspend", "profiles.restore"]);
    expect(log.every((entry) => entry.actor_id === u.adminA && entry.college_id === c.a)).toBe(true);
    expect(log[2].metadata).toMatchObject({ reason: REASON, days: 7 });
    const history = (await ok(u.adminA, "admin_get_user", { p_user: target })).history;
    expect(history.map((entry) => entry.action)).toEqual(log.map((entry) => entry.action));
  });

  test("a timed suspension ends by itself, and that is recorded as automatic", async () => {
    const target = await makeStudent(c.a, { firstName: "Nitin", gender: "male" });
    await ok(u.adminA, "admin_moderate_user", { p_user: target, p_action: "suspend", p_reason: "Cooling-off period after a warning.", p_days: 1 });
    await models.AccountModeration.updateOne({ _id: target }, { $set: { suspended_until: new Date(Date.now() - 1000) } });
    expect(await ok(target, "my_account_status")).toEqual({ status: "active", suspended_until: null });
    expect((await Profile.findById(target).lean()).status).toBe("active");
    const last = await AuditLog.findOne({ target_id: target }).sort({ seq: -1 }).lean();
    expect(last).toMatchObject({ action: "profiles.restore", actor_id: null });
    expect(last.metadata.automatic).toBe(true);
  });

  test("nobody moderates themselves; staff only by a Super Admin; a Super Admin by nobody", async () => {
    const REASON = "Testing the staff protection rules.";
    const staffStudent = await makeStudent(c.a, { firstName: "Ojas", gender: "male", role: "admin" });
    await models.AdminCollegeAccess.create({ admin_user_id: staffStudent, college_id: c.a, permissions: ["manage_students"] });
    const superStudent = await makeStudent(c.a, { firstName: "Priya", gender: "female", role: "super_admin" });
    const suspend = (who, target) => refused(who, "admin_moderate_user", { p_user: target, p_action: "suspend", p_reason: REASON });

    expect(await suspend(staffStudent, staffStudent)).toBe("cannot_moderate_self");
    expect(await suspend(u.adminA, staffStudent)).toBe("cannot_moderate_staff");
    expect(await suspend(u.adminA, superStudent)).toBe("cannot_moderate_staff");
    expect(await suspend(u.superAdmin, superStudent)).toBe("cannot_moderate_staff");
    expect(await suspend(superStudent, superStudent)).toBe("cannot_moderate_self");
    expect(await suspend(u.superAdmin, staffStudent)).toBeNull();
    await ok(u.superAdmin, "admin_moderate_user", { p_user: staffStudent, p_action: "restore" });
  });
});

describe("the audit log", () => {
  test("is scoped per admin, and cannot be changed or removed through the models", async () => {
    await ok(u.adminA, "admin_create_event", {
      college_id: c.a, title: "Logged event", event_type: "technical", description: "An event created to appear in the log.", venue: "Hall",
      starts_at: new Date(Date.now() + 5 * 86400000).toISOString(), ends_at: new Date(Date.now() + 5 * 86400000 + 3600000).toISOString(),
      registration_opens_at: null, registration_closes_at: null, minimum_age: 18, eligibility_rules: { colleges: { mode: "selected", ids: [] }, courses: [], study_years: [] }, requirements: null,
    });
    const extra = await makeAdmin(null, []);
    await ok(u.superAdmin, "admin_assign_college", { user_id: extra, college_id: c.a, permissions: ["view_students"] });

    const tables = async (who, args) => [...new Set((await ok(who, "list_audit", { limit: 100, ...args })).rows.map((row) => row.target_table))].sort();
    expect(await tables(u.superAdmin)).toEqual(["admin_college_access", "events", "profiles", "reports"]);
    expect(await tables(u.adminA)).toEqual(["events", "profiles", "reports"]);
    expect(await tables(u.modA)).toEqual(["profiles", "reports"]);
    expect(await tables(u.viewerA)).toEqual([]);
    expect(await tables(u.eventsB)).toEqual([]);
    expect(await tables(u.adminNone)).toEqual([]);
    // Filters narrow; they never widen.
    expect(await tables(u.modA, { category: "admin_college_access" })).toEqual([]);
    expect(await tables(u.modA, { category: "events" })).toEqual([]);
    expect(await tables(u.modA, { college: c.b })).toEqual([]);
    expect(await tables(u.modA, { category: { $ne: "x" } })).toEqual([]);
    expect(await refused(u.a1, "list_audit")).toBe("not_authorized");
    const page = await ok(u.superAdmin, "list_audit", { limit: 2, offset: 1 });
    expect(page.rows).toHaveLength(2);
    expect(page.total).toBeGreaterThan(10);
    expect(page.rows[0].id).toBeGreaterThan(page.rows[1].id); // newest first

    const entry = await AuditLog.findOne({}).lean();
    await expect(AuditLog.updateOne({ _id: entry._id }, { $set: { action: "nothing.happened" } })).rejects.toThrow();
    await expect(AuditLog.deleteOne({ _id: entry._id })).rejects.toThrow();
    await expect(AuditLog.deleteMany({})).rejects.toThrow();
    await expect(AuditLog.findOneAndUpdate({ _id: entry._id }, { $set: { actor_id: null } })).rejects.toThrow();
    await expect(AuditLog.findOneAndDelete({ _id: entry._id })).rejects.toThrow();
    await expect(AuditLog.replaceOne({ _id: entry._id }, { seq: entry.seq, action: "nothing.happened" })).rejects.toThrow();
    await expect(AuditLog.bulkWrite([{ deleteOne: { filter: { _id: entry._id } } }])).rejects.toThrow();
    const loaded = await AuditLog.findById(entry._id);
    loaded.action = "nothing.happened";
    await expect(loaded.save()).rejects.toThrow();
    await expect(loaded.deleteOne()).rejects.toThrow();
    expect(await AuditLog.countDocuments({})).toBeGreaterThan(10);
    expect((await AuditLog.findById(entry._id).lean()).action).toBe(entry.action);
  });
});

describe("analytics", () => {
  test("exact numbers for a known set of rows; a match is one pair", async () => {
    const college = (await models.College.create({ name: "Count College", name_lower: "count college", slug: `count-${randomUUID().slice(0, 6)}`, is_active: true }))._id;
    const admin = await makeAdmin(college, ["view_students", "manage_events", "moderate_reports"]);
    const limited = await makeAdmin(college, ["manage_events"]);
    const men = [];
    const women = [];
    for (let i = 0; i < 3; i += 1) men.push(await makeStudent(college, { firstName: `Man${i}`, gender: "male" }));
    for (let i = 0; i < 3; i += 1) women.push(await makeStudent(college, { firstName: `Woman${i}`, gender: "female" }));
    const event = await makeEvent(college, { title: "Counted" });
    await makeEvent(college, { title: "Hidden draft", status: "draft", published_at: null });
    await makeEvent(college, { title: "Done", status: "completed", starts_at: new Date(Date.now() - 5 * 86400000) });

    for (const man of men) await ok(man, "join_event", { p_event_id: event, p_looking_for: "female" });
    for (const woman of women) await ok(woman, "join_event", { p_event_id: event, p_looking_for: "male" });
    const handle = (id) => handleOf(event, id);
    await ok(men[0], "send_interest", { p_event_id: event, p_handle: await handle(women[0]) });
    await ok(women[0], "send_interest", { p_event_id: event, p_handle: await handle(men[0]) }); // match 1
    await ok(men[1], "send_interest", { p_event_id: event, p_handle: await handle(women[1]) });
    await ok(women[1], "send_interest", { p_event_id: event, p_handle: await handle(men[1]) }); // match 2
    await ok(men[2], "send_interest", { p_event_id: event, p_handle: await handle(women[0]) }); // one-sided
    await ok(women[2], "set_event_profile_open", { p_event_id: event, p_open: false });
    await ok(men[2], "report_partner", { p_event_id: event, p_handle: await handle(women[1]), p_reason: "spam" });
    await Profile.updateOne({ _id: men[2] }, { $set: { status: "suspended" } });

    const overview = await ok(admin, "admin_overview_stats", { p_college: college });
    expect(overview.colleges).toEqual({ total: 1, open: 1 });
    expect(overview.events).toMatchObject({ published: 1, closed: 0, completed: 1, upcoming: 1 });
    expect(overview.participation).toMatchObject({ participations: 6, participants: 6, active_discovery: 4 }); // one closed, one suspended
    expect(overview.interests.total).toBe(5);
    expect(overview.matches.total).toBe(2); // two pairs — not four people
    expect(overview.students).toMatchObject({ total: 6, active: 5, suspended: 1, under_review: 0 });
    expect(overview.reports).toMatchObject({ submitted: 1, pending: 1, in_review: 0, resolved: 0, dismissed: 0 });
    expect(overview.accounts).toBeUndefined(); // platform-wide account numbers are for the Super Admin's unfiltered view
    expect(JSON.stringify(overview)).not.toMatch(/Man0|Woman0|[0-9a-f]{8}-[0-9a-f]{4}-/);

    const narrow = await ok(limited, "admin_overview_stats");
    expect(narrow.students).toBeUndefined();
    expect(narrow.reports).toBeUndefined();
    expect(narrow.matches.total).toBe(2);
    expect(await refused(limited, "admin_overview_stats", { p_college: c.a })).toBe("not_authorized");
    expect(await refused(men[0], "admin_overview_stats")).toBe("not_authorized");
    expect((await ok(u.superAdmin, "admin_overview_stats")).accounts.registered).toBe(await models.User.countDocuments({}));

    const today = new Date().toISOString().slice(0, 10);
    expect((await ok(admin, "admin_overview_stats", { p_from: today, p_to: today, p_tz: "UTC" })).matches.in_period).toBe(2);
    expect((await ok(admin, "admin_overview_stats", { p_from: "2020-01-01", p_to: "2020-01-02" })).matches).toEqual({ total: 2, in_period: 0 });

    const [row] = await ok(admin, "admin_college_stats");
    expect(row).toMatchObject({ college_name: "Count College", students: 6, students_active: 5, students_suspended: 1, events_published: 1, events_completed: 1, participations: 6, active_discovery: 4, interests: 5, matches: 2, reports_submitted: 1, reports_closed: 0 });
    expect((await ok(limited, "admin_college_stats"))[0]).toMatchObject({ students: null, reports_submitted: null, matches: 2 });
    expect((await ok(u.superAdmin, "admin_college_stats")).length).toBeGreaterThanOrEqual(4);
    expect(await ok(u.adminNone, "admin_college_stats")).toEqual([]);

    const events = await ok(admin, "admin_event_stats");
    expect(events.map((item) => item.title).sort()).toEqual(["Counted", "Done", "Hidden draft"]);
    expect(events.find((item) => item.title === "Counted")).toMatchObject({ participants: 6, active_discovery: 4, interests: 5, matches: 2, matched_participants: 4, reports: 1, total: 3 });
    const viewerOnly = await makeAdmin(college, ["view_students"]);
    const seen = await ok(viewerOnly, "admin_event_stats");
    expect(seen.map((item) => item.title).sort()).toEqual(["Counted", "Done"]); // drafts only for those who manage events
    expect(seen[0].reports).toBeNull();
    expect((await ok(admin, "admin_event_stats", { p_search: "count" })).map((item) => item.title)).toEqual(["Counted"]);
    expect((await ok(admin, "admin_event_stats", { p_status: "completed" })).map((item) => item.title)).toEqual(["Done"]);
    expect(await ok(admin, "admin_event_stats", { p_college: c.a })).toEqual([]);
    expect(await ok(admin, "admin_event_stats", { p_event: eventA })).toEqual([]);
    expect((await errorOf(admin, "admin_event_stats", { p_status: "x" })).message).toBe("invalid_request");
  });
});
