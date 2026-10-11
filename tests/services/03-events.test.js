// Events: who manages, who sees, validation, status transitions, eligibility.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { courseMatches, courseTokens } from "@/lib/services/events";
import { createWorld, days, errorOf, makeEvent, makeStudent, models, ok, refused, testDatabase } from "./helpers";

const { AuditLog, Event } = models;
const db = testDatabase("events");
let c;
let u;
beforeAll(async () => {
  await db.start();
  ({ c, u } = await createWorld());
});
afterAll(() => db.stop());

const row = (overrides = {}) => ({
  title: "Tech Fest",
  event_type: "technical",
  description: "Two days of talks, a hackathon and a quiz final.",
  venue: "Auditorium",
  starts_at: days(5).toISOString(),
  ends_at: days(5, 6).toISOString(),
  registration_opens_at: null,
  registration_closes_at: null,
  minimum_age: 18,
  eligibility_rules: { colleges: { mode: "selected", ids: [] }, courses: [], study_years: [] },
  requirements: null,
  ...overrides,
});
const stored = (id) => Event.findById(id).lean();

describe("who may manage events", () => {
  test("a Super Admin creates for any open college; server-owned fields are set by the service", async () => {
    const id = await ok(u.superAdmin, "admin_create_event", { college_id: c.b, ...row({ status: "published", slug: "my-own-slug", created_by: u.a1, published_at: new Date() }) });
    const event = await stored(id);
    expect(event).toMatchObject({ status: "draft", published_at: null, created_by: u.superAdmin, college_id: c.b });
    expect(event.slug).toMatch(/^tech-fest-[0-9a-f]{6}$/);
    expect(event.eligibility_rules).toEqual({ colleges: { mode: "selected", ids: [c.b] }, courses: [], study_years: [] }); // host always included
  });

  test("an admin needs manage_events on THAT college — another college, another permission or being a student there is not enough", async () => {
    expect(await ok(u.adminA, "admin_create_event", { college_id: c.a, ...row() })).toMatch(/^[0-9a-f-]{36}$/);
    for (const who of [u.eventsB, u.viewerA, u.modA, u.adminNone]) expect(await refused(who, "admin_create_event", { college_id: c.a, ...row() })).toBe("not_authorized");
    expect(await refused(u.superAdmin, "admin_create_event", { college_id: c.closed, ...row() })).toBe("invalid_college");
    const bEvent = await makeEvent(c.b);
    expect(await ok(u.adminA, "admin_get_event", { event_id: bEvent })).toBeNull();
    expect(await ok(u.adminA, "admin_update_event", { event_id: bEvent, row: row() })).toBe(false);
    expect(await refused(u.adminA, "admin_change_event_status", { event_id: bEvent, from: "published", to: "closed" })).toBe("event_not_found");
    expect((await ok(u.adminA, "admin_list_events")).some((event) => event.id === bEvent)).toBe(false);
    expect(await ok(u.adminA, "admin_list_events", { college: c.b })).toEqual([]);
  });

  test("the creator's id is never returned by any read", async () => {
    const id = await makeEvent(c.a, { created_by: u.adminA });
    const admin = await ok(u.adminA, "admin_get_event", { event_id: id });
    const slug = (await stored(id)).slug;
    const student = await ok(u.a1, "get_student_event", { slug });
    for (const view of [admin, student]) expect(Object.keys(view)).not.toContain("created_by");
    expect(Object.keys(student)).not.toContain("published_at");
  });
});

describe("validation on every write", () => {
  test("dates and the participation window", async () => {
    const create = (overrides) => errorOf(u.adminA, "admin_create_event", { college_id: c.a, ...row(overrides) });
    expect(await create({ ends_at: days(4).toISOString() })).toMatchObject({ code: "23514", message: "events_time_order" });
    expect(await create({ registration_opens_at: days(3).toISOString(), registration_closes_at: days(2).toISOString() })).toMatchObject({ message: "events_registration_order" });
    expect(await create({ registration_closes_at: days(9).toISOString() })).toMatchObject({ message: "events_registration_within_event" });
    expect((await create({ minimum_age: 16 })).code).toBe("23514");
    expect((await create({ title: "ab" })).code).toBe("23514");
    expect((await create({ event_type: "rave" })).code).toBe("23514");
  });

  test("eligibility rules are validated and stored in one canonical form", async () => {
    const id = await ok(u.superAdmin, "admin_create_event", {
      college_id: c.a,
      ...row({ eligibility_rules: { colleges: { mode: "selected", ids: [c.b, c.b] }, courses: ["  b.tech ", "MBA", "B.Tech"], study_years: [3, 1, 3] } }),
    });
    expect((await stored(id)).eligibility_rules).toEqual({ colleges: { mode: "selected", ids: [c.a, c.b].sort() }, courses: ["B.Tech", "MBA"], study_years: [1, 3] });
    const bad = (rules) => refused(u.superAdmin, "admin_create_event", { college_id: c.a, ...row({ eligibility_rules: rules }) });
    expect(await bad(null)).toBe("invalid_eligibility_rules");
    expect(await bad({ secret: true })).toBe("invalid_eligibility_rules");
    expect(await bad({ colleges: { mode: "some" } })).toBe("invalid_eligibility_rules");
    expect(await bad({ colleges: { mode: "selected", ids: ["not-an-id"] } })).toBe("invalid_eligibility_rules");
    expect(await bad({ colleges: { mode: "selected", ids: ["3f2b8c1e-5a4d-4e6f-9a7b-0c1d2e3f4a5b"] } })).toBe("unknown_college_in_rules");
    expect(await bad({ courses: ["<script>"] })).toBe("invalid_eligibility_rules");
    expect(await bad({ study_years: [0] })).toBe("invalid_eligibility_rules");
    expect(await bad({ study_years: ["2"] })).toBe("invalid_eligibility_rules");
  });

  test("course rules match whole words, ignoring case and punctuation", () => {
    expect(courseTokens("B.Tech (Computer Science)")).toEqual(["btech", "computer", "science"]);
    expect(courseMatches("B.Tech Computer Science", "b tech")).toBe(false);
    expect(courseMatches("B.Tech Computer Science", "B.TECH")).toBe(true);
    expect(courseMatches("MBA Finance", "BA")).toBe(false);
    expect(courseMatches("BA Economics", "BA")).toBe(true);
    expect(courseMatches("B.Tech Computer Science", "computer science")).toBe(true);
    expect(courseMatches("B.Tech", "")).toBe(false);
  });
});

describe("status", () => {
  test("draft → published → closed → published → completed; the publish time is kept on re-opening; everything is audited", async () => {
    const id = await ok(u.adminA, "admin_create_event", { college_id: c.a, ...row() });
    const move = (from, to) => ok(u.adminA, "admin_change_event_status", { event_id: id, from, to });
    expect(await refused(u.adminA, "admin_change_event_status", { event_id: id, from: "draft", to: "closed" })).toBe("invalid_status_transition");
    expect(await move("draft", "published")).toBe(true);
    const publishedAt = (await stored(id)).published_at;
    expect(publishedAt).toBeInstanceOf(Date);
    expect(await move("draft", "published").catch(() => "refused")).not.toBe(true); // stale view: nothing changes
    expect(await move("published", "closed")).toBe(true);
    expect(await move("closed", "published")).toBe(true);
    expect((await stored(id)).published_at.getTime()).toBe(publishedAt.getTime());
    expect(await move("published", "completed")).toBe(true);
    // Completed is final: no status change, no edits.
    expect(await refused(u.adminA, "admin_change_event_status", { event_id: id, from: "completed", to: "published" })).toBe("event_completed_locked");
    expect(await refused(u.adminA, "admin_update_event", { event_id: id, row: row() })).toBe("event_completed_locked");
    const actions = await AuditLog.find({ target_table: "events", target_id: id }).sort({ seq: 1 }).lean();
    expect(actions.map((entry) => `${entry.action}:${entry.metadata.new.status}`)).toEqual(["events.insert:draft", "events.update:published", "events.update:closed", "events.update:published", "events.update:completed"]);
    expect(actions.every((entry) => entry.actor_id === u.adminA && entry.college_id === c.a)).toBe(true);
  });

  test("an event that has ended, or lacks a description or venue, cannot be published", async () => {
    const ended = await makeEvent(c.a, { status: "draft", starts_at: days(-3), ends_at: days(-2) });
    expect(await refused(u.adminA, "admin_change_event_status", { event_id: ended, from: "draft", to: "published" })).toBe("event_already_ended");
    const bare = await makeEvent(c.a, { status: "draft", venue: "  " });
    expect(await refused(u.adminA, "admin_change_event_status", { event_id: bare, from: "draft", to: "published" })).toBe("event_incomplete");
  });

  test("edits are saved and content edits are not audited", async () => {
    const id = await ok(u.adminA, "admin_create_event", { college_id: c.a, ...row() });
    expect(await ok(u.adminA, "admin_update_event", { event_id: id, row: row({ title: "Tech Fest 2", minimum_age: 19, status: "published", college_id: c.b, slug: "x" }) })).toBe(true);
    expect(await stored(id)).toMatchObject({ title: "Tech Fest 2", minimum_age: 19, status: "draft", college_id: c.a });
    expect((await stored(id)).slug).toMatch(/^tech-fest-/); // the address never changes
    expect(await AuditLog.countDocuments({ target_table: "events", target_id: id })).toBe(1);
  });
});

describe("who sees events", () => {
  test("a draft is visible to its managers only — a student cannot find it by list, slug or id", async () => {
    const id = await makeEvent(c.a, { status: "draft", published_at: null });
    const slug = (await stored(id)).slug;
    expect((await ok(u.a1, "list_student_events")).some((event) => event.id === id)).toBe(false);
    expect(await ok(u.a1, "get_student_event", { slug })).toBeNull();
    expect(await refused(u.a1, "event_participation_check", { p_event_id: id })).toBe("event_not_found");
    expect(await refused(u.a1, "join_event", { p_event_id: id, p_looking_for: "female" })).toBe("event_not_found");
    expect((await ok(u.adminA, "admin_get_event", { event_id: id })).status).toBe("draft");
    // …and a manager's own draft never leaks into the student pages either.
    expect(await ok(u.adminA, "list_student_events")).not.toContainEqual(expect.objectContaining({ id }));
  });

  test("published for the host only, for selected colleges, for all colleges", async () => {
    const hostOnly = await makeEvent(c.a);
    const selected = await makeEvent(c.a, { eligibility_rules: { colleges: { mode: "selected", ids: [c.a, c.b] }, courses: [], study_years: [] } });
    const everyone = await makeEvent(c.a, { eligibility_rules: { colleges: { mode: "all" }, courses: [], study_years: [] } });
    const seenBy = async (who) => new Set((await ok(who, "list_student_events")).map((event) => event.id));
    const a = await seenBy(u.a1);
    const b = await seenBy(u.b1);
    expect([hostOnly, selected, everyone].every((id) => a.has(id))).toBe(true);
    expect([b.has(hostOnly), b.has(selected), b.has(everyone)]).toEqual([false, true, true]);
    // "Not invited" and "does not exist" give the same answer.
    expect(await ok(u.b1, "get_student_event", { slug: (await stored(hostOnly)).slug })).toBeNull();
    expect(await ok(u.b1, "get_student_event", { slug: "no-such-event" })).toBeNull();
    // No profile, or a suspended one: no events at all.
    expect(await ok(u.newcomer, "list_student_events")).toEqual([]);
    expect(await ok(u.suspendedA, "list_student_events")).toEqual([]);
  });

  test("closed and completed events stay visible as history", async () => {
    const closed = await makeEvent(c.a, { status: "closed" });
    const completed = await makeEvent(c.a, { status: "completed" });
    const seen = new Set((await ok(u.a1, "list_student_events")).map((event) => event.id));
    expect(seen.has(closed) && seen.has(completed)).toBe(true);
  });
});

describe("may this student take part?", () => {
  const check = (who, id) => ok(who, "event_participation_check", { p_event_id: id });

  test("an eligible student may; every unmet rule is listed", async () => {
    const open = await makeEvent(c.a);
    expect(await check(u.a1, open)).toEqual({ can_participate: true, blockers: [], is_verified: false });
    const strict = await makeEvent(c.a, { minimum_age: 25, eligibility_rules: { colleges: { mode: "selected", ids: [c.a] }, courses: ["MBA"], study_years: [5] } });
    const noPhoto = await makeStudent(c.a, { photo: false });
    expect((await check(noPhoto, strict)).blockers.sort()).toEqual(["course_not_eligible", "photo_missing", "under_age", "year_not_eligible"]);
  });

  test("age is measured on the day the event starts", async () => {
    const almost = await makeStudent(c.a, { age: 20 });
    const soon = await makeEvent(c.a, { minimum_age: 21, starts_at: days(5) });
    const nextYear = await makeEvent(c.a, { minimum_age: 21, starts_at: days(400), ends_at: days(400, 4) });
    expect((await check(almost, soon)).blockers).toEqual(["under_age"]);
    expect((await check(almost, nextYear)).blockers).toEqual([]);
  });

  test("the participation window, closed and ended events", async () => {
    const notYet = await makeEvent(c.a, { registration_opens_at: days(2) });
    const over = await makeEvent(c.a, { registration_closes_at: days(-1) });
    const closed = await makeEvent(c.a, { status: "closed" });
    const ended = await makeEvent(c.a, { starts_at: days(-2), ends_at: days(-1) });
    expect((await check(u.a1, notYet)).blockers).toEqual(["registration_not_open"]);
    expect((await check(u.a1, over)).blockers).toEqual(["registration_closed"]);
    expect((await check(u.a1, closed)).blockers).toEqual(["event_closed"]);
    expect((await check(u.a1, ended)).blockers).toEqual(["event_completed"]);
  });

  test("a manager without a student profile gets a plain answer when previewing", async () => {
    const id = await makeEvent(c.a, { status: "draft" });
    expect((await check(u.adminA, id)).blockers).toEqual(["no_profile"]);
  });
});
