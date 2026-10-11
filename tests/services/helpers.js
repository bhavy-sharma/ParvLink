// Shared set-up for the service tests.
//
// These tests call the services directly with a caller context — the same
// functions the pages and Server Actions call — against a real MongoDB. Each
// test file gets a database of its own, dropped afterwards.
//
//   MONGO_BASE_URI   set by scripts/test-services-local.sh (or by hand), e.g. mongodb://127.0.0.1:27017

import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { connectDb, disconnectDb } from "@/lib/db/connection";
import * as models from "@/lib/db/models";
import { run } from "@/lib/services";
import { contextFor, makeContext } from "@/lib/services/core";

const { AdminCollegeAccess, College, Event, Photo, Profile, ProfilePrivate, User } = models;

export function testDatabase(label) {
  const [base, query = ""] = (process.env.MONGO_BASE_URI ?? "").split("?");
  if (!base) throw new Error("MONGO_BASE_URI is not set. Run `npm run test:services:local`, or point it at a MongoDB you can use for throw-away databases.");
  process.env.MONGODB_URI = `${base.replace(/\/$/, "")}/cpf_test_${label}_${randomUUID().slice(0, 8)}${query ? `?${query}` : ""}`;
  process.env.APP_URL = "http://app.test";
  return {
    start: () => connectDb(),
    stop: async () => {
      const connection = await connectDb();
      await connection.dropDatabase();
      await disconnectDb();
    },
  };
}

export const anon = () => makeContext(null);
/** The caller context for a user id — role read from the database, like a real request. */
export const as = (userId) => contextFor(userId);

/** Calls a service; returns its data, or throws if it was refused. */
export async function ok(userId, name, args) {
  const { data, error } = await run(userId ? await as(userId) : anon(), name, args);
  if (error) throw new Error(`${name} was refused: ${error.message}${error.details ? ` (${error.details})` : ""}`);
  return data;
}
/** Calls a service that is expected to be refused; returns the refusal code (or null if it went through). */
export async function refused(userId, name, args) {
  const { error } = await run(userId ? await as(userId) : anon(), name, args);
  return error ? error.message : null;
}
/** The whole error, for tests that look at `code` or `details`. */
export async function errorOf(userId, name, args) {
  return (await run(userId ? await as(userId) : anon(), name, args)).error;
}

export const dobForAge = (years) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate() - 1)).toISOString().slice(0, 10);
};
export const days = (n, hours = 0) => new Date(Date.now() + n * 86400000 + hours * 3600000);

let webp = null;
export async function tinyWebp() {
  webp ??= await sharp({ create: { width: 8, height: 8, channels: 3, background: "#3b2fb8" } }).webp().toBuffer();
  return webp;
}

export async function makeUser({ email = `${randomUUID().slice(0, 8)}@svc.test`, role = "student", confirmed = true } = {}) {
  const user = await User.create({ email, password_hash: null, email_confirmed_at: confirmed ? new Date() : null, role });
  return user._id;
}

export async function makeStudent(collegeId, { firstName = "Asha", course = "B.Tech Computer Science", year = 2, age = 20, gender = null, photo = true, status = "active", role = "student" } = {}) {
  const id = await makeUser({ role });
  let avatar = null;
  if (photo) {
    avatar = `${id}/${randomUUID()}.webp`;
    const data = await tinyWebp();
    await Photo.create({ _id: avatar, user_id: id, size: data.length, data });
  }
  await ProfilePrivate.create({ _id: id, date_of_birth: dobForAge(age), gender });
  await Profile.create({ _id: id, first_name: firstName, first_name_lower: firstName.toLowerCase(), college_id: collegeId, course, study_year: year, avatar_path: avatar, status });
  return id;
}

export async function makeCollege(name, { active = true } = {}) {
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${randomUUID().slice(0, 6)}`;
  return (await College.create({ name, name_lower: name.toLowerCase(), slug, is_active: active }))._id;
}

export async function makeAdmin(collegeId, permissions) {
  const id = await makeUser({ role: "admin" });
  if (collegeId) await AdminCollegeAccess.create({ admin_user_id: id, college_id: collegeId, permissions });
  return id;
}

export async function makeEvent(collegeId, overrides = {}) {
  const starts = overrides.starts_at ?? days(10);
  const event = await Event.create({
    college_id: collegeId,
    title: `Event ${randomUUID().slice(0, 6)}`,
    slug: `event-${randomUUID().slice(0, 12)}`,
    description: "A test event with enough description.",
    venue: "Hall",
    starts_at: starts,
    ends_at: new Date(starts.getTime() + 4 * 3600000),
    status: "published",
    published_at: new Date(),
    eligibility_rules: { colleges: { mode: "selected", ids: [collegeId] }, courses: [], study_years: [] },
    ...overrides,
  });
  return event._id;
}

/**
 * A small world most files share:
 *   colleges   a, b (open), closed
 *   staff      superAdmin; adminA (every permission on a); viewerA (view_students on a);
 *              modA (moderate_reports on a); eventsB (manage_events on b); adminNone (no college)
 *   students   a1 (male), a2 (female), a3 (female) at a; b1 (female) at b; suspendedA; newcomer (no profile)
 */
export async function createWorld() {
  const c = { a: await makeCollege("College A"), b: await makeCollege("College B"), closed: await makeCollege("Closed College", { active: false }) };
  const u = {
    superAdmin: await makeUser({ role: "super_admin" }),
    adminA: await makeAdmin(c.a, ["view_students", "manage_students", "manage_events", "moderate_reports"]),
    viewerA: await makeAdmin(c.a, ["view_students"]),
    modA: await makeAdmin(c.a, ["moderate_reports"]),
    eventsB: await makeAdmin(c.b, ["manage_events"]),
    adminNone: await makeAdmin(null, []),
    a1: await makeStudent(c.a, { firstName: "Arjun", gender: "male" }),
    a2: await makeStudent(c.a, { firstName: "Bela", gender: "female" }),
    a3: await makeStudent(c.a, { firstName: "Chitra", gender: "female" }),
    b1: await makeStudent(c.b, { firstName: "Divya", gender: "female" }),
    suspendedA: await makeStudent(c.a, { firstName: "Sam", gender: "male", status: "suspended" }),
    newcomer: await makeUser(),
    unverified: await makeUser({ confirmed: false }),
  };
  return { c, u };
}

/** Both join the event and send each other interest. Returns the conversation id. */
export async function match(eventId, one, two, { oneWants = "female", twoWants = "male" } = {}) {
  await ok(one, "join_event", { p_event_id: eventId, p_looking_for: oneWants });
  await ok(two, "join_event", { p_event_id: eventId, p_looking_for: twoWants });
  await ok(one, "send_interest", { p_event_id: eventId, p_handle: await handleOf(eventId, two) });
  const { state } = await ok(two, "send_interest", { p_event_id: eventId, p_handle: await handleOf(eventId, one) });
  if (state !== "matched") throw new Error("expected a match");
  const [low, high] = one < two ? [one, two] : [two, one];
  const row = await models.Match.findOne({ event_id: eventId, user_a_id: low, user_b_id: high }).lean();
  return { conversation: row.public_id, matchId: row._id };
}

export async function handleOf(eventId, userId) {
  return (await models.EventParticipant.findOne({ event_id: eventId, user_id: userId }).lean())?.public_id ?? null;
}

export { models, run };
