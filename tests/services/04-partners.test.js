// Finding a partner: joining, discovery, interest and matching, closing, blocking, reporting.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createWorld, days, errorOf, handleOf, makeEvent, makeStudent, makeUser, match, models, ok, refused, run, as, testDatabase } from "./helpers";

const { Block, EventParticipant, Interest, Match, Profile, ProfilePrivate, Report } = models;
const db = testDatabase("partners");
let c;
let u;
beforeAll(async () => {
  await db.start();
  ({ c, u } = await createWorld());
});
afterAll(() => db.stop());

const both = (ids) => ({ colleges: { mode: "selected", ids }, courses: [], study_years: [] });
const names = (cards) => cards.map((card) => card.first_name).sort();
const discover = (who, event) => ok(who, "discover_event_partners", { p_event_id: event });

describe("joining an event", () => {
  test("stores a preference; gender is asked once and cannot be changed afterwards", async () => {
    const event = await makeEvent(c.a);
    const fresh = await makeStudent(c.a, { firstName: "Esha", gender: null });
    expect(await refused(fresh, "join_event", { p_event_id: event, p_looking_for: "male" })).toBe("gender_required");
    expect(await refused(fresh, "join_event", { p_event_id: event, p_looking_for: "anyone", p_gender: "female" })).toBe("invalid_preference");
    expect(await EventParticipant.countDocuments({ user_id: fresh })).toBe(0);

    expect(await ok(fresh, "join_event", { p_event_id: event, p_looking_for: "male", p_gender: "female" })).toEqual({ status: "active", looking_for: "male" });
    expect((await ProfilePrivate.findById(fresh).lean()).gender).toBe("female");
    expect(await refused(fresh, "join_event", { p_event_id: event, p_looking_for: "male", p_gender: "male" })).toBe("gender_locked");
    expect((await ProfilePrivate.findById(fresh).lean()).gender).toBe("female");

    // Joining again changes the preference, and never makes a second participation.
    await ok(fresh, "join_event", { p_event_id: event, p_looking_for: "female" });
    expect(await EventParticipant.countDocuments({ event_id: event, user_id: fresh })).toBe(1);
    expect(await ok(fresh, "my_event_participation", { p_event_id: event })).toMatchObject({ joined: true, status: "active", looking_for: "female", gender: "female", blockers: [] });
  });

  test("refused for a student who may not take part — and nothing is stored", async () => {
    const onlyThirdYear = await makeEvent(c.a, { eligibility_rules: { colleges: { mode: "selected", ids: [c.a] }, courses: [], study_years: [3] } });
    const error = await errorOf(u.a1, "join_event", { p_event_id: onlyThirdYear, p_looking_for: "female" });
    expect(error).toMatchObject({ message: "participation_blocked", details: "year_not_eligible" });
    expect(await EventParticipant.countDocuments({ event_id: onlyThirdYear })).toBe(0);

    const eventA = await makeEvent(c.a);
    expect(await refused(u.b1, "join_event", { p_event_id: eventA, p_looking_for: "male" })).toBe("event_not_found"); // not invited: the event does not exist for her
    expect(await refused(u.suspendedA, "join_event", { p_event_id: eventA, p_looking_for: "female" })).toBe("account_suspended");
    expect(await refused(u.newcomer, "join_event", { p_event_id: eventA, p_looking_for: "female" })).toBe("event_not_found");
    expect(await refused(null, "join_event", { p_event_id: eventA, p_looking_for: "female" })).toBe("not_authenticated");
    expect(await refused(u.a1, "join_event", { p_event_id: "not-an-id", p_looking_for: "female" })).toBe("event_not_found");

    const draft = await makeEvent(c.a, { status: "draft", published_at: null });
    expect(await refused(u.a1, "join_event", { p_event_id: draft, p_looking_for: "female" })).toBe("event_not_found");
    const over = await makeEvent(c.a, { status: "completed" });
    expect((await errorOf(u.a1, "join_event", { p_event_id: over, p_looking_for: "female" })).message).toBe("participation_blocked");
  });

  test("two simultaneous joins make one participation", async () => {
    const event = await makeEvent(c.a);
    const results = await Promise.all([1, 2, 3, 4].map(() => refused(u.a1, "join_event", { p_event_id: event, p_looking_for: "female" })));
    expect(results).toEqual([null, null, null, null]);
    expect(await EventParticipant.countDocuments({ event_id: event, user_id: u.a1 })).toBe(1);
  });
});

describe("discovery", () => {
  test("shows only mutually compatible, eligible, open, unblocked students — and only approved fields", async () => {
    const event = await makeEvent(c.a, { eligibility_rules: both([c.a, c.b]) });
    const wantsWomen = await makeStudent(c.a, { firstName: "Gita", gender: "female" });
    const closed = await makeStudent(c.a, { firstName: "Hema", gender: "female" });
    const suspended = await makeStudent(c.a, { firstName: "Indu", gender: "female" });
    const blockedOne = await makeStudent(c.a, { firstName: "Jaya", gender: "female" });
    const noPhoto = await makeStudent(c.a, { firstName: "Kavya", gender: "female" });

    await ok(u.a1, "join_event", { p_event_id: event, p_looking_for: "female" });
    for (const who of [u.a2, u.b1, closed, suspended, blockedOne, noPhoto]) await ok(who, "join_event", { p_event_id: event, p_looking_for: "male" });
    await ok(wantsWomen, "join_event", { p_event_id: event, p_looking_for: "female" });
    await ok(closed, "set_event_profile_open", { p_event_id: event, p_open: false });
    await Profile.updateOne({ _id: suspended }, { $set: { status: "suspended" } });
    await Block.create({ blocker_id: blockedOne, blocked_id: u.a1 });
    await Profile.updateOne({ _id: noPhoto }, { $set: { avatar_path: null } }); // removed her photo after joining: no longer eligible

    const cards = await discover(u.a1, event);
    expect(names(cards)).toEqual(["Bela", "Divya"]);
    for (const card of cards) {
      expect(Object.keys(card).sort()).toEqual(["course", "first_name", "handle", "has_photo", "relation", "study_year", "total"]);
      expect(card.total).toBe(2);
      expect(card.relation).toBe("none");
      expect(card.has_photo).toBe(true);
    }
    // Nothing in the answer identifies an account.
    const text = JSON.stringify(cards);
    for (const id of [u.a2, u.b1]) expect(text).not.toContain(id);
    expect(text).not.toMatch(/gender|date_of_birth|avatar_path|email|user_id/);

    // The same rules from the other side.
    expect(names(await discover(u.a2, event))).toEqual(["Arjun"]);
    expect(await discover(blockedOne, event)).toEqual([]);
    expect(await discover(wantsWomen, event)).toEqual([]); // nobody here is a woman looking for women

    // Paging is bounded and stable.
    const first = await ok(u.a1, "discover_event_partners", { p_event_id: event, p_limit: 1, p_offset: 0 });
    const second = await ok(u.a1, "discover_event_partners", { p_event_id: event, p_limit: 1, p_offset: 1 });
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(names([...first, ...second])).toEqual(["Bela", "Divya"]);
    expect(await ok(u.a1, "discover_event_partners", { p_event_id: event, p_limit: 100000, p_offset: -5 })).toHaveLength(2);
  });

  test("needs an open participation of one's own", async () => {
    const event = await makeEvent(c.a);
    expect(await refused(u.a1, "discover_event_partners", { p_event_id: event })).toBe("not_joined");
    await ok(u.a1, "join_event", { p_event_id: event, p_looking_for: "female" });
    await ok(u.a1, "set_event_profile_open", { p_event_id: event, p_open: false });
    expect(await refused(u.a1, "discover_event_partners", { p_event_id: event })).toBe("profile_closed");
    expect(await refused(u.adminA, "discover_event_partners", { p_event_id: event })).toBe("event_not_found"); // staff without a profile are not participants
  });

  test("a student who stops being eligible disappears, without anything being deleted", async () => {
    const event = await makeEvent(c.a);
    const mover = await makeStudent(c.a, { firstName: "Lata", gender: "female" });
    await ok(u.a1, "join_event", { p_event_id: event, p_looking_for: "female" });
    await ok(mover, "join_event", { p_event_id: event, p_looking_for: "male" });
    expect(names(await discover(u.a1, event))).toEqual(["Lata"]);
    await Profile.updateOne({ _id: mover }, { $set: { college_id: c.b } });
    expect(await discover(u.a1, event)).toEqual([]);
    expect(await EventParticipant.countDocuments({ event_id: event, user_id: mover })).toBe(1);
  });
});

describe("interest and matching", () => {
  test("match notifications clear when read and count future matches again", async () => {
    await ok(u.a1, "mark_my_matches_seen");
    await ok(u.a2, "mark_my_matches_seen");
    const first = await makeEvent(c.a);
    await match(first, u.a1, u.a2);

    expect(await ok(u.a1, "my_unread_match_count")).toBe(1);
    expect(await ok(u.a2, "my_unread_match_count")).toBe(1);
    await ok(u.a1, "mark_my_matches_seen");
    expect(await ok(u.a1, "my_unread_match_count")).toBe(0);
    expect(await ok(u.a2, "my_unread_match_count")).toBe(1);

    const second = await makeEvent(c.a);
    await match(second, u.a1, u.a2);
    expect(await ok(u.a1, "my_unread_match_count")).toBe(1);
  });

  test("one-sided interest stays private; mutual interest makes exactly one match", async () => {
    const event = await makeEvent(c.a);
    await ok(u.a1, "join_event", { p_event_id: event, p_looking_for: "female" });
    await ok(u.a2, "join_event", { p_event_id: event, p_looking_for: "male" });
    const a2 = await handleOf(event, u.a2);
    const a1 = await handleOf(event, u.a1);

    expect(await ok(u.a1, "send_interest", { p_event_id: event, p_handle: a2 })).toEqual({ state: "sent" });
    expect(await ok(u.a1, "send_interest", { p_event_id: event, p_handle: a2 })).toEqual({ state: "already_sent" });
    expect(await Interest.countDocuments({ event_id: event })).toBe(1);
    expect((await discover(u.a1, event))[0].relation).toBe("sent");
    expect((await discover(u.a2, event))[0].relation).toBe("received");
    expect(await ok(u.a2, "list_received_interests", { p_event_id: event })).toMatchObject([{ first_name: "Arjun", relation: "received", available: true }]);
    expect(await ok(u.a2, "my_received_interest_counts")).toMatchObject([
      { event_id: event, event_title: expect.any(String), event_slug: expect.any(String), pending_count: 1 },
    ]);
    expect(await ok(u.a1, "list_received_interests", { p_event_id: event })).toEqual([]);
    expect(await ok(u.a2, "my_partner_summary")).toMatchObject({ matches: 0, waiting_interests: 1 });
    expect(await ok(u.a1, "list_my_conversations")).toEqual([]);

    expect(await ok(u.a2, "send_interest", { p_event_id: event, p_handle: a1 })).toEqual({ state: "matched" });
    expect(await ok(u.a1, "send_interest", { p_event_id: event, p_handle: a2 })).toEqual({ state: "matched" });
    expect(await Match.countDocuments({ event_id: event })).toBe(1);
    expect(await Interest.countDocuments({ event_id: event, status: "accepted" })).toBe(2);
    expect((await discover(u.a1, event))[0].relation).toBe("matched");
    expect((await ok(u.a1, "my_partner_summary")).waiting_interests).toBe(0);
  });

  test("dashboard counts pending interests per visible event, including missing recipient participation", async () => {
    const firstEvent = await makeEvent(c.a);
    const secondEvent = await makeEvent(c.a);
    for (const event of [firstEvent, secondEvent]) {
      await ok(u.a1, "join_event", { p_event_id: event, p_looking_for: "female" });
      await ok(u.a2, "join_event", { p_event_id: event, p_looking_for: "male" });
      await ok(u.a1, "send_interest", { p_event_id: event, p_handle: await handleOf(event, u.a2) });
    }
    await Interest.create({ event_id: firstEvent, from_user_id: u.a3, to_user_id: u.a2, status: "pending" });
    await EventParticipant.deleteOne({ event_id: secondEvent, user_id: u.a2 });

    const counts = await ok(u.a2, "my_received_interest_counts");
    expect(counts).toHaveLength(2);
    expect(counts.find((row) => row.event_id === firstEvent)).toMatchObject({ pending_count: 2 });
    expect(counts.find((row) => row.event_id === secondEvent)).toMatchObject({ pending_count: 1 });
  });

  test("both pressing at the same moment still makes one match", async () => {
    for (let round = 0; round < 5; round += 1) {
      const event = await makeEvent(c.a);
      await ok(u.a1, "join_event", { p_event_id: event, p_looking_for: "female" });
      await ok(u.a2, "join_event", { p_event_id: event, p_looking_for: "male" });
      const [a1, a2] = [await handleOf(event, u.a1), await handleOf(event, u.a2)];
      const results = await Promise.all([
        ok(u.a1, "send_interest", { p_event_id: event, p_handle: a2 }),
        ok(u.a2, "send_interest", { p_event_id: event, p_handle: a1 }),
        ok(u.a1, "send_interest", { p_event_id: event, p_handle: a2 }),
        ok(u.a2, "send_interest", { p_event_id: event, p_handle: a1 }),
      ]);
      expect(results.some((result) => result.state === "matched")).toBe(true);
      expect(await Match.countDocuments({ event_id: event })).toBe(1);
      expect(await Interest.countDocuments({ event_id: event })).toBe(2);
    }
  });

  test("refused for oneself, strangers, incompatible or unavailable students — with one neutral answer", async () => {
    const event = await makeEvent(c.a);
    const other = await makeEvent(c.a);
    await ok(u.a1, "join_event", { p_event_id: event, p_looking_for: "female" });
    await ok(u.a2, "join_event", { p_event_id: event, p_looking_for: "male" });
    await ok(u.a3, "join_event", { p_event_id: event, p_looking_for: "female" }); // not looking for men
    await ok(u.a2, "join_event", { p_event_id: other, p_looking_for: "male" });
    const send = (who, handle, ev = event) => refused(who, "send_interest", { p_event_id: ev, p_handle: handle });

    expect(await send(u.a1, await handleOf(event, u.a1))).toBe("self_interest");
    expect(await send(u.a1, randomUUID())).toBe("partner_not_available");
    expect(await send(u.a1, "x")).toBe("partner_not_available");
    expect(await send(u.a1, u.a2)).toBe("partner_not_available"); // a user id is not a handle
    expect(await send(u.a1, await handleOf(other, u.a2))).toBe("partner_not_available"); // a handle of another event
    expect(await send(u.a1, await handleOf(event, u.a3))).toBe("partner_not_available"); // incompatible
    expect(await send(u.a1, await handleOf(other, u.a2), other)).toBe("not_joined");

    await ok(u.a2, "set_event_profile_open", { p_event_id: event, p_open: false });
    expect(await send(u.a1, await handleOf(event, u.a2))).toBe("partner_not_available");
    expect(await send(u.a2, await handleOf(event, u.a1))).toBe("profile_closed");
    await ok(u.a2, "set_event_profile_open", { p_event_id: event, p_open: true });

    await Profile.updateOne({ _id: u.a2 }, { $set: { status: "suspended" } });
    expect(await send(u.a1, await handleOf(event, u.a2))).toBe("partner_not_available");
    expect(await send(u.a2, await handleOf(event, u.a1))).toBe("account_suspended");
    await Profile.updateOne({ _id: u.a2 }, { $set: { status: "active" } });

    await Event_close(event);
    expect((await errorOf(u.a1, "send_interest", { p_event_id: event, p_handle: await handleOf(event, u.a2) })).message).toBe("participation_blocked");
    expect(await Interest.countDocuments({ event_id: event })).toBe(0);
  });

  test("at most 50 new interests per event per day", async () => {
    const event = await makeEvent(c.a);
    await ok(u.a1, "join_event", { p_event_id: event, p_looking_for: "female" });
    await ok(u.a2, "join_event", { p_event_id: event, p_looking_for: "male" });
    await Interest.insertMany(Array.from({ length: 50 }, () => ({ event_id: event, from_user_id: u.a1, to_user_id: randomUUID() })));
    expect(await refused(u.a1, "send_interest", { p_event_id: event, p_handle: await handleOf(event, u.a2) })).toBe("interest_limit_reached");
  });
});

const Event_close = (id) => models.Event.updateOne({ _id: id }, { $set: { status: "closed" } });

describe("closing a profile for one event", () => {
  test("hides the student there only; matches stay; re-opening re-checks eligibility", async () => {
    const one = await makeEvent(c.a);
    const two = await makeEvent(c.a);
    const { conversation } = await match(one, u.a1, u.a2);
    await ok(u.a1, "join_event", { p_event_id: two, p_looking_for: "female" });
    await ok(u.a3, "join_event", { p_event_id: one, p_looking_for: "male" });
    await ok(u.a3, "join_event", { p_event_id: two, p_looking_for: "male" });

    expect(await ok(u.a1, "set_event_profile_open", { p_event_id: one, p_open: false })).toBe("closed");
    expect(await ok(u.a3, "discover_event_partners", { p_event_id: one })).toEqual([]);
    expect(names(await discover(u.a3, two))).toEqual(["Arjun"]);
    expect(await Match.countDocuments({ event_id: one })).toBe(1);
    expect((await ok(u.a1, "chat_open", { p_conversation: conversation })).can_send).toBe(true);

    expect(await refused(u.a1, "set_event_profile_open", { p_event_id: one, p_open: "yes" })).toBe("invalid_request");
    expect(await refused(u.b1, "set_event_profile_open", { p_event_id: one, p_open: false })).toBe("not_joined");
    await Event_close(one);
    expect((await errorOf(u.a1, "set_event_profile_open", { p_event_id: one, p_open: true })).message).toBe("participation_blocked");
    // Closing is always allowed, even when the event no longer accepts anyone.
    expect(await ok(u.a3, "set_event_profile_open", { p_event_id: one, p_open: false })).toBe("closed");
  });
});

describe("photos of other students", () => {
  test("served by event handle, only to someone who may see that student", async () => {
    const event = await makeEvent(c.a, { eligibility_rules: both([c.a, c.b]) });
    await ok(u.a1, "join_event", { p_event_id: event, p_looking_for: "female" });
    await ok(u.a2, "join_event", { p_event_id: event, p_looking_for: "male" });
    await ok(u.a3, "join_event", { p_event_id: event, p_looking_for: "female" });
    const a2 = await handleOf(event, u.a2);
    const photo = (who) => ok(who, "partner_photo", { p_event_id: event, p_handle: a2 });

    const seen = await photo(u.a1);
    expect(seen.content_type).toBe("image/webp");
    expect(Buffer.isBuffer(seen.data) && seen.data.length > 0).toBe(true);
    expect(await photo(u.a2)).not.toBeNull(); // her own
    expect(await photo(u.a3)).toBeNull(); // incompatible: not shown to her
    expect(await photo(u.b1)).toBeNull(); // has not joined
    expect(await photo(u.adminA)).toBeNull();
    expect(await photo(u.superAdmin)).toBeNull();
    expect(await refused(null, "partner_photo", { p_event_id: event, p_handle: a2 })).toBe("not_authenticated");

    await ok(u.a2, "block_partner", { p_event_id: event, p_handle: await handleOf(event, u.a1) });
    expect(await photo(u.a1)).toBeNull();
  });
});

describe("blocking", () => {
  test("hides both from each other in every event, is private, and only the blocker can undo it", async () => {
    const one = await makeEvent(c.a);
    const two = await makeEvent(c.a);
    const x = await makeStudent(c.a, { firstName: "Mohan", gender: "male" });
    const y = await makeStudent(c.a, { firstName: "Nila", gender: "female" });
    for (const event of [one, two]) {
      await ok(x, "join_event", { p_event_id: event, p_looking_for: "female" });
      await ok(y, "join_event", { p_event_id: event, p_looking_for: "male" });
    }
    await ok(x, "send_interest", { p_event_id: one, p_handle: await handleOf(one, y) });
    expect((await ok(y, "my_partner_summary")).waiting_interests).toBe(1);

    await ok(y, "block_partner", { p_event_id: one, p_handle: await handleOf(one, x) });
    await ok(y, "block_partner", { p_event_id: one, p_handle: await handleOf(one, x) }); // repeating changes nothing
    expect(await Block.countDocuments({ blocker_id: y })).toBe(1);
    for (const event of [one, two]) {
      expect(await discover(x, event)).toEqual([]);
      expect(await discover(y, event)).toEqual([]);
    }
    expect(await ok(y, "list_received_interests", { p_event_id: one })).toEqual([]);
    expect((await ok(y, "my_partner_summary")).waiting_interests).toBe(0);
    // The blocked student gets the same neutral answer as for anyone unavailable.
    expect(await refused(x, "send_interest", { p_event_id: two, p_handle: await handleOf(two, y) })).toBe("partner_not_available");
    expect(await refused(x, "block_partner", { p_event_id: two, p_handle: await handleOf(two, y) })).toBe("partner_not_available");

    const mine = await ok(y, "list_my_blocks");
    expect(mine).toMatchObject([{ first_name: "Mohan" }]);
    expect(Object.keys(mine[0]).sort()).toEqual(["block_id", "blocked_at", "course", "first_name"]);
    expect(await ok(x, "list_my_blocks")).toEqual([]); // being blocked is not shown to the blocked student

    expect(await refused(x, "unblock_partner", { p_block_id: mine[0].block_id })).toBe("block_not_found");
    expect(await refused(y, "unblock_partner", { p_block_id: "nope" })).toBe("block_not_found");
    await ok(y, "unblock_partner", { p_block_id: mine[0].block_id });
    expect(names(await discover(x, two))).toEqual(["Nila"]);
  });

  test("a handle alone is not enough: only someone the caller can see", async () => {
    const event = await makeEvent(c.a);
    await ok(u.a1, "join_event", { p_event_id: event, p_looking_for: "female" });
    await ok(u.a3, "join_event", { p_event_id: event, p_looking_for: "female" });
    expect(await refused(u.a1, "block_partner", { p_event_id: event, p_handle: await handleOf(event, u.a3) })).toBe("partner_not_available");
    expect(await refused(u.a1, "block_partner", { p_event_id: event, p_handle: await handleOf(event, u.a1) })).toBe("partner_not_available");
    expect(await refused(u.adminA, "block_partner", { p_event_id: event, p_handle: await handleOf(event, u.a1) })).toBe("partner_not_available");
  });
});

describe("reporting a profile", () => {
  test("is filed by the caller, about a student they can see, for the reported student's college", async () => {
    const event = await makeEvent(c.a, { eligibility_rules: both([c.a, c.b]) });
    const reporter = await makeStudent(c.a, { firstName: "Omar", gender: "male" });
    await ok(reporter, "join_event", { p_event_id: event, p_looking_for: "female" });
    await ok(u.b1, "join_event", { p_event_id: event, p_looking_for: "male" });
    await ok(u.a3, "join_event", { p_event_id: event, p_looking_for: "female" });
    const b1 = await handleOf(event, u.b1);
    const report = (args, who = reporter) => refused(who, "report_partner", { p_event_id: event, p_handle: b1, p_reason: "spam", ...args });

    expect(await report({ p_reason: "threats" })).toBe("invalid_report_reason"); // a chat-only reason
    expect(await report({ p_details: "x".repeat(1001) })).toBe("report_details_too_long");
    expect(await report({ p_handle: await handleOf(event, reporter) })).toBe("partner_not_available");
    expect(await report({ p_handle: await handleOf(event, u.a3) })).toBe("partner_not_available"); // not visible to him
    expect(await report({}, u.adminA)).toBe("partner_not_available");
    expect(await Report.countDocuments({ reporter_id: reporter })).toBe(0);

    expect(await ok(reporter, "report_partner", { p_event_id: event, p_handle: b1, p_reason: "fake_profile", p_details: "  Photo is of a film actor.  ", reporter_id: u.a2, college_id: c.a, status: "resolved" })).toBe("reported");
    const stored = await Report.findOne({ reporter_id: reporter }).lean();
    expect(stored).toMatchObject({ reported_user_id: u.b1, college_id: c.b, event_id: event, reason: "fake_profile", details: "Photo is of a film actor.", status: "open", match_id: null, evidence: null });
    expect(await ok(reporter, "report_partner", { p_event_id: event, p_handle: b1, p_reason: "spam" })).toBe("already_reported");
    expect(await Report.countDocuments({ reporter_id: reporter })).toBe(1);

    // After blocking, the profile is no longer visible — but it can still be reported.
    await ok(reporter, "block_partner", { p_event_id: event, p_handle: b1 });
    expect(await ok(reporter, "report_partner", { p_event_id: event, p_handle: b1, p_reason: "spam" })).toBe("already_reported");
    // Once a moderator has decided it, a new report can be filed.
    await ok(u.superAdmin, "admin_set_report_status", { p_report: stored._id, p_status: "dismissed", p_note: "Checked the photo; it is hers." });
    expect(await ok(reporter, "report_partner", { p_event_id: event, p_handle: b1, p_reason: "harassment" })).toBe("reported");
    expect(await Report.countDocuments({ reporter_id: reporter })).toBe(2);
  });

  test("ten reports a day per person", async () => {
    const event = await makeEvent(c.a);
    const reporter = await makeStudent(c.a, { firstName: "Pia", gender: "female" });
    await ok(reporter, "join_event", { p_event_id: event, p_looking_for: "male" });
    await ok(u.a1, "join_event", { p_event_id: event, p_looking_for: "female" });
    await Report.insertMany(Array.from({ length: 10 }, () => ({ reporter_id: reporter, reported_user_id: await_id(), college_id: c.a, reason: "spam", open_key: randomUUID() })));
    expect(await refused(reporter, "report_partner", { p_event_id: event, p_handle: await handleOf(event, u.a1), p_reason: "spam" })).toBe("report_limit_reached");
  });
});
const await_id = () => randomUUID();

describe("who can call these at all", () => {
  test("signed-out callers and people without a confirmed profile get nowhere", async () => {
    const event = await makeEvent(c.a);
    for (const name of ["join_event", "discover_event_partners", "send_interest", "list_received_interests", "block_partner", "report_partner", "my_event_participation", "set_event_profile_open"]) {
      expect(await refused(null, name, { p_event_id: event, p_handle: randomUUID(), p_looking_for: "male", p_reason: "spam", p_open: false })).toBe("not_authenticated");
    }
    for (const name of ["my_partner_summary", "list_my_blocks"]) expect(await refused(null, name)).toBe("not_authenticated");
    // A caller context cannot be forged from request data: unknown ids are nobody.
    const ghost = await as(randomUUID());
    expect((await run(ghost, "my_partner_summary")).error?.message).toBe("not_authenticated");
    const unverified = await makeUser({ confirmed: false });
    expect(await refused(unverified, "join_event", { p_event_id: event, p_looking_for: "male" })).not.toBeNull();
    expect(days(1) > new Date()).toBe(true);
  });
});
