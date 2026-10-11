// Shared steps for the end-to-end tests.
//
// The tests drive the real production build in a browser. Two things are done
// from outside the browser, because a test cannot do them through the UI:
//   * reading the emails the app sent (from the local SMTP sink, E2E_MAIL_API)
//     — the only place a confirmation or reset link exists, since the database
//     stores tokens as hashes;
//   * looking at, and seeding, the database directly (MONGODB_URI) through the
//     same Mongoose models the app uses.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect } from "@playwright/test";
import sharp from "sharp";
import { connectDb, disconnectDb } from "../../src/lib/db/connection.js";
import * as models from "../../src/lib/db/models.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const run = promisify(execFile);

export const PASSWORD = "correct-horse-battery-9";
export const MAIL_API = process.env.E2E_MAIL_API;

/** The app's Mongoose models, connected to the database the app under test uses. */
export async function db() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required for the end-to-end tests (scripts/test-e2e-local.sh sets it).");
  process.env.MONGODB_SKIP_INDEX_SYNC = "1"; // the app builds its own indexes
  await connectDb();
  return models;
}
export async function closeDb() {
  await disconnectDb();
}

export const runTag = randomUUID().slice(0, 8);
export const uniqueEmail = (name) => `${name}-${runTag}@e2e.test`;

export function dobForAge(years) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

// --- email ------------------------------------------------------------------

/** Every email the app has sent to this address, oldest first. */
export async function mailFor(email) {
  if (!MAIL_API) throw new Error("E2E_MAIL_API is required for the end-to-end tests.");
  return (await fetch(`${MAIL_API}/messages?to=${encodeURIComponent(email.toLowerCase())}`)).json();
}
export async function allMail() {
  return (await fetch(`${MAIL_API}/messages`)).json();
}
/** Makes the mail server refuse messages (or accept them again). */
export async function setMailOutage(fail) {
  await fetch(`${MAIL_API}/fail`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fail }) });
}

/** The newest emailed link of one kind ("email" = confirm address, "recovery" = reset password), as a path on this site. */
async function emailedLink(email, type, { after = 0 } = {}) {
  let found = null;
  await expect
    .poll(async () => {
      const mails = (await mailFor(email)).filter((mail) => mail.link?.endsWith(`type=${type}`));
      found = mails.length > after ? mails.at(-1) : null;
      return Boolean(found);
    }, { message: `a "${type}" email for ${email}` })
    .toBe(true);
  const url = new URL(found.link);
  // Links are built from APP_URL — never from anything a request said.
  expect(url.origin).toBe(new URL(process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100").origin);
  return `${url.pathname}${url.search}`;
}
export const confirmationLink = (email, options) => emailedLink(email, "email", options);
export const recoveryLink = (email, options) => emailedLink(email, "recovery", options);

// --- database: look-ups and set-up ----------------------------------------------

export async function userId(email) {
  const { User } = await db();
  return (await User.findOne({ email: email.toLowerCase() }).select("_id").lean())?._id ?? null;
}
export async function userRow(email) {
  const { User } = await db();
  return User.findOne({ email: email.toLowerCase() }).lean();
}
export async function profileRow(email) {
  const { Profile } = await db();
  const id = await userId(email);
  return id ? Profile.findById(id).lean() : null;
}

export async function seedCollege(name, { active = true } = {}) {
  const { College } = await db();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return (await College.create({ name, name_lower: name.toLowerCase(), slug, is_active: active }))._id;
}

/** Runs the operator's command-line script — the only way a Super Admin is ever made. */
export async function bootstrapSuperAdmin(email) {
  await run(process.execPath, ["scripts/super-admin.mjs", "promote", email], { cwd: ROOT, env: process.env });
  expect((await userRow(email)).role).toBe("super_admin");
}

// --- UI steps ---------------------------------------------------------------

export async function register(page, email, password = PASSWORD) {
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByLabel(/I have read and agree/).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/verify-email$/);
}

/** Opens the newest confirmation link this address was emailed. Returns the link (a path). */
export async function confirmEmail(page, email) {
  const link = await confirmationLink(email);
  await page.goto(link);
  return link;
}

export async function login(page, email, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

export async function logout(page) {
  await page.getByRole("button", { name: "Log out" }).first().click();
  await expect(page).toHaveURL(/\/login$/);
}

export async function fillOnboarding(page, { firstName, college, course = "B.Tech Computer Science", year = "2nd year", dob = dobForAge(20), bio = "" }) {
  await expect(page.getByRole("heading", { name: "Create your profile" })).toBeVisible();
  await page.getByLabel("First name").fill(firstName);
  await page.getByLabel("College").selectOption({ label: college });
  await page.getByLabel("Course").fill(course);
  await page.getByLabel("Year of study").selectOption({ label: year });
  await page.getByLabel("Date of birth").fill(dob);
  if (bio) await page.getByLabel("About you").fill(bio);
  await page.getByRole("button", { name: "Create profile" }).click();
}

/** Register → confirm → onboard. Leaves the page on the student dashboard. */
export async function createStudent(page, { email, firstName, college }) {
  await register(page, email);
  await confirmEmail(page, email);
  await expect(page).toHaveURL(/\/onboarding$/);
  await fillOnboarding(page, { firstName, college });
  await expect(page.getByRole("heading", { name: `Hi, ${firstName}` })).toBeVisible();
}

/** Register → confirm only (no student profile). */
export async function createAccount(page, email) {
  await register(page, email);
  await confirmEmail(page, email);
  await expect(page).toHaveURL(/\/onboarding$/);
}

export function photoWithGps() {
  return sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 59, g: 47, b: 184 } } })
    .withExif({ IFD0: { Copyright: "e2e-secret-marker" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "19/1 4/1 33/1" } })
    .jpeg()
    .toBuffer();
}

// --- Phase 2: events ----------------------------------------------------------

/** Gives an existing account the admin role and one college assignment (set-up only; the UI for this is tested in 03-admin). */
export async function makeAdmin(email, collegeId, permissions) {
  const { AdminCollegeAccess, User } = await db();
  const id = await userId(email);
  await User.updateOne({ _id: id }, { $set: { role: "admin" } });
  await AdminCollegeAccess.create({ admin_user_id: id, college_id: collegeId, permissions });
}

/** A value for <input type="datetime-local">, `days` from now, in the app's time zone (Asia/Kolkata). */
export function localDateTime(days, time = "19:00") {
  const date = new Date(Date.now() + days * 86400000);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  return `${day}T${time}`;
}

export async function eventRow(title) {
  const { Event } = await db();
  const event = await Event.findOne({ title }).lean();
  return event ? { ...event, id: event._id } : null;
}

/**
 * A form control by its label, among what is currently on screen. Next.js keeps
 * recently visited pages mounted but hidden, so the same label can exist twice
 * in the DOM (for example the create form and the edit form).
 */
export const field = (scope, label, options) => scope.getByLabel(label, options).filter({ visible: true });

export async function fillEventForm(page, { title, type = "Dandiya Night", host, description, venue, starts, ends, minimumAge }) {
  if (title !== undefined) await field(page, "Event title").fill(title);
  if (type) await field(page, "Event type").selectOption({ label: type });
  if (host) await field(page, "Host college", { exact: true }).selectOption({ label: host });
  if (description !== undefined) await field(page, "Description").fill(description);
  if (venue !== undefined) await field(page, "Venue").fill(venue);
  if (starts !== undefined) await field(page, "Starts", { exact: true }).fill(starts);
  if (ends !== undefined) await field(page, "Ends", { exact: true }).fill(ends);
  if (minimumAge !== undefined) await field(page, "Minimum age").fill(String(minimumAge));
}

// --- Phase 3: partner finding ---------------------------------------------------

/** Inserts a published event directly (event management itself is tested in 04-events). */
export async function seedEvent(title, collegeId, rules = {}, overrides = {}) {
  const { Event } = await db();
  const starts = new Date(Date.now() + 10 * 86400000);
  const event = await Event.create({
    college_id: collegeId,
    title,
    slug: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${randomUUID().slice(0, 6)}`,
    description: "Garba and dandiya on the main lawn. Come as a pair, or find a partner here.",
    event_type: "dandiya_night",
    venue: "Main lawn",
    starts_at: starts,
    ends_at: new Date(starts.getTime() + 4 * 3600000),
    eligibility_rules: { colleges: { mode: "selected", ids: [collegeId] }, courses: [], study_years: [], ...rules },
    status: "published",
    published_at: new Date(),
    ...overrides,
  });
  return { id: event._id, slug: event.slug };
}

export async function uploadPhoto(page) {
  await page.goto("/profile");
  await field(page, /Choose a photo|Replace photo/).setInputFiles({ name: "me.jpg", mimeType: "image/jpeg", buffer: await photoWithGps() });
  await page.getByRole("button", { name: "Upload photo" }).click();
  await expect(page.getByText("Photo updated.")).toBeVisible();
}

/** The event-specific handle other students see for this person (null if they have not joined). */
export async function handleOf(eventId, email) {
  const { EventParticipant } = await db();
  return (await EventParticipant.findOne({ event_id: eventId, user_id: await userId(email) }).lean())?.public_id ?? null;
}

export async function partnerCounts(eventId) {
  const { EventParticipant, Interest, Match } = await db();
  return {
    participants: await EventParticipant.countDocuments({ event_id: eventId }),
    interests: await Interest.countDocuments({ event_id: eventId }),
    matches: await Match.countDocuments({ event_id: eventId }),
  };
}

/** Event page → Find Your Partner → choose → confirm. Ends on the partner page. */
export async function joinEvent(page, slug, { gender = null, lookingFor }) {
  await page.goto(`/events/${slug}/join`);
  if (gender) await field(page, gender, { exact: true }).check();
  await field(page, `Looking for a ${lookingFor} partner`).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Confirm and join" }).click();
  await expect(page).toHaveURL(new RegExp(`/events/${slug}/partners$`));
}

// --- Phase 4: chat ----------------------------------------------------------------

/**
 * Seeds a match between two students: both joined, both interested, matched.
 * (Joining and matching through the UI is tested in 05-partners; the rules
 * behind them in tests/services.) `one` and `two` are { email, gender, lookingFor }.
 * Returns the conversation id.
 */
export async function makeMatch(event, one, two) {
  const { EventParticipant, Interest, Match, ProfilePrivate } = await db();
  const ids = [];
  for (const who of [one, two]) {
    const id = await userId(who.email);
    ids.push(id);
    await ProfilePrivate.updateOne({ _id: id, gender: null }, { $set: { gender: who.gender } });
    await EventParticipant.updateOne({ event_id: event.id, user_id: id }, { $set: { status: "active", looking_for: who.lookingFor, closed_at: null } }, { upsert: true });
  }
  const now = new Date();
  for (const [from, to] of [[ids[0], ids[1]], [ids[1], ids[0]]]) {
    await Interest.updateOne({ event_id: event.id, from_user_id: from, to_user_id: to }, { $set: { status: "accepted", responded_at: now } }, { upsert: true });
  }
  const [low, high] = ids[0] < ids[1] ? ids : [ids[1], ids[0]];
  await Match.updateOne({ event_id: event.id, user_a_id: low, user_b_id: high }, { $setOnInsert: { status: "active" } }, { upsert: true });
  const match = await Match.findOne({ event_id: event.id, user_a_id: low, user_b_id: high }).lean();
  return { matchId: match._id, conversation: match.public_id };
}

export async function storedMessages(matchId) {
  const { Message } = await db();
  return (await Message.find({ match_id: matchId }).sort({ seq: 1 }).lean()).map(({ seq, body, sender_id }) => ({ seq, body, sender_id }));
}

/** A second browser session for an existing account (its own cookies). */
export async function sessionFor(browser, email, password = PASSWORD) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, email, password);
  await expect(page).not.toHaveURL(/\/login/);
  return { context, page, request: context.request };
}

/**
 * Cuts this page off from the chat's live-update stream (and restores it), the
 * way a blocked or flaky connection would. Sending and loading still work.
 */
export async function setLiveUpdates(page, enabled) {
  if (enabled) await page.unroute("**/matches/*/events");
  else await page.route("**/matches/*/events", (route) => route.abort());
}

/**
 * Stores a message as if `senderId` had sent it from another device: takes the
 * next number of the conversation and writes the message, like the service does.
 * For set-up only — what the service accepts and refuses is tested in tests/services/05-chat.
 */
export async function storeMessage(matchId, senderId, body, { at = new Date() } = {}) {
  const { Match, Message } = await db();
  const match = await Match.findOneAndUpdate({ _id: matchId }, { $inc: { last_seq: 1 } }, { new: true }).lean();
  await Message.collection.insertOne({ _id: randomUUID(), match_id: matchId, sender_id: senderId, body, client_id: randomUUID(), seq: match.last_seq, created_at: at });
  return match.last_seq;
}

/** Lets earlier sends fall out of the one-minute rate-limit window. */
export async function ageMessages() {
  const { Message } = await db();
  const recent = await Message.find({ created_at: { $gt: new Date(Date.now() - 120000) } }).select("created_at").lean();
  // created_at is write-once through the model, so this set-up step uses the driver directly.
  for (const message of recent) await Message.collection.updateOne({ _id: message._id }, { $set: { created_at: new Date(message.created_at.getTime() - 120000) } });
}

/**
 * Reads a conversation's live-update stream as this page's session would, for a
 * short while. Resolves with { status, contentType, text } — `text` is whatever
 * arrived before the time was up.
 */
export async function readLiveStream(page, conversation, ms = 4000) {
  return page.evaluate(
    async ({ url, ms }) => {
      const controller = new AbortController();
      const response = await fetch(url, { signal: controller.signal, redirect: "manual" });
      const result = { status: response.status, contentType: response.headers.get("content-type") ?? "", text: "" };
      if (response.status !== 200 || !response.body) return result;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const stop = setTimeout(() => controller.abort(), ms);
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          result.text += decoder.decode(value, { stream: true });
        }
      } catch {
        // aborted when the time was up
      }
      clearTimeout(stop);
      return result;
    },
    { url: `/matches/${conversation}/events`, ms },
  );
}
