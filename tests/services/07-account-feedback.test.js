// Leaving: deleting one's own account (immediate, held, completed by a Super Admin), and the feedback inbox.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createSession, getSessionUser } from "@/lib/services/auth";
import { hashToken, newToken } from "@/lib/auth/tokens";
import { createWorld, handleOf, makeEvent, makeStudent, makeUser, match, models, ok, refused, testDatabase } from "./helpers";

const {
  AccountDeletionRequest, AccountModeration, AuditLog, AuthToken, Block, EventParticipant, Feedback, Interest, Match, Message, Photo, Profile, ProfilePrivate,
  Report, ReportNote, Session, User,
} = models;
const db = testDatabase("account");
let c;
let u;
beforeAll(async () => {
  await db.start();
  ({ c, u } = await createWorld());
});
afterAll(() => db.stop());

const NOTE = "Reviewed and decided by the moderation team.";

describe("deleting your own account", () => {
  test("erases the account and everything personal; keeps reports and the log without a link to a person", async () => {
    const event = await makeEvent(c.a);
    const leaver = await makeStudent(c.a, { firstName: "Leaver", gender: "male" });
    const partner = await makeStudent(c.a, { firstName: "Stays", gender: "female" });
    const third = await makeStudent(c.a, { firstName: "Third", gender: "female" });
    const { conversation, matchId } = await match(event, leaver, partner);
    await ok(leaver, "chat_send", { p_conversation: conversation, p_body: "from the leaver", p_client_id: randomUUID() });
    await ok(partner, "chat_send", { p_conversation: conversation, p_body: "from the partner", p_client_id: randomUUID() });
    await ok(third, "join_event", { p_event_id: event, p_looking_for: "male" });
    await ok(leaver, "send_interest", { p_event_id: event, p_handle: await handleOf(event, third) });
    await ok(leaver, "report_partner", { p_event_id: event, p_handle: await handleOf(event, third), p_reason: "spam", p_details: "kept after I leave" });
    await ok(leaver, "block_partner", { p_event_id: event, p_handle: await handleOf(event, third) });
    await ok(leaver, "submit_feedback", { p_category: "idea", p_description: "A suggestion that outlives the account." });
    // A decided report about the leaver does not hold the deletion.
    const decided = (await Report.create({ reporter_id: partner, reported_user_id: leaver, college_id: c.a, reason: "spam", status: "dismissed", open_key: randomUUID() }))._id;
    await ReportNote.create({ report_id: decided, author_id: u.adminA, body: "note" });
    const session = await createSession(leaver, {});
    await AuthToken.create({ user_id: leaver, kind: "reset_password", token_hash: hashToken(newToken()), expires_at: new Date(Date.now() + 3600000) });
    const photoKey = (await Profile.findById(leaver).lean()).avatar_path;

    expect(await ok(leaver, "delete_my_account")).toBe("deleted");

    expect(await User.findById(leaver).lean()).toBeNull();
    expect(await Profile.findById(leaver).lean()).toBeNull();
    expect(await ProfilePrivate.findById(leaver).lean()).toBeNull();
    expect(await Photo.findById(photoKey).lean()).toBeNull();
    expect(await AccountModeration.findById(leaver).lean()).toBeNull();
    expect(await Session.countDocuments({ user_id: leaver })).toBe(0);
    expect(await AuthToken.countDocuments({ user_id: leaver })).toBe(0);
    expect(await getSessionUser(session.token)).toBeNull(); // the cookie the browser still holds is worth nothing
    expect(await EventParticipant.countDocuments({ user_id: leaver })).toBe(0);
    expect(await Interest.countDocuments({ $or: [{ from_user_id: leaver }, { to_user_id: leaver }] })).toBe(0);
    expect(await Match.countDocuments({ _id: matchId })).toBe(0);
    expect(await Message.countDocuments({ match_id: matchId })).toBe(0); // the whole conversation, both sides
    expect(await Block.countDocuments({ $or: [{ blocker_id: leaver }, { blocked_id: leaver }] })).toBe(0);

    // Kept, unlinked.
    expect(await Report.findOne({ details: "kept after I leave" }).lean()).toMatchObject({ reporter_id: null, reported_user_id: third, status: "open" });
    expect(await Report.findById(decided).lean()).toMatchObject({ reporter_id: partner, reported_user_id: null });
    expect(await Feedback.findOne({ description: /outlives/ }).lean()).toMatchObject({ user_id: null, college_id: c.a });
    const entry = await AuditLog.findOne({ action: "accounts.deleted", target_id: leaver }).lean();
    expect(entry).toMatchObject({ actor_id: leaver, college_id: c.a, metadata: { by: "self", ref: `U-${leaver.slice(0, 8).toUpperCase()}` } });
    expect(JSON.stringify(entry)).not.toContain("Leaver");
    expect(await AccountDeletionRequest.findById(leaver).lean()).toMatchObject({ status: "completed", decided_by: "self" });

    // The people who remain are untouched and see no trace of a conversation.
    expect(await Profile.countDocuments({ _id: { $in: [partner, third] } })).toBe(2);
    expect(await ok(partner, "list_my_conversations")).toEqual([]);
    expect(await refused(partner, "chat_open", { p_conversation: conversation })).toBe("conversation_not_found");
    // The deleted account can do nothing more.
    expect(await refused(leaver, "delete_my_account")).toBe("not_authenticated");
    expect(await refused(leaver, "my_profile")).toBe("not_authenticated");
  });

  test("takes no parameter: it is always the caller's account", async () => {
    const victim = await makeStudent(c.a, { firstName: "Victim" });
    const caller = await makeStudent(c.a, { firstName: "Caller" });
    expect(await ok(caller, "delete_my_account", { p_user: victim, user_id: victim, uid: victim })).toBe("deleted");
    expect(await User.exists({ _id: victim })).not.toBeNull();
    expect(await User.exists({ _id: caller })).toBeNull();
    expect(await refused(null, "delete_my_account")).toBe("not_authenticated");
  });

  test("an account without a profile can be deleted; staff cannot delete themselves", async () => {
    const bare = await makeUser();
    expect(await ok(bare, "delete_my_account")).toBe("deleted");
    expect(await User.exists({ _id: bare })).toBeNull();
    for (const staff of [u.adminA, u.superAdmin]) {
      expect(await refused(staff, "delete_my_account")).toBe("staff_cannot_self_delete");
      expect(await User.exists({ _id: staff })).not.toBeNull();
    }
  });

  test("held while suspended or while a report about the student is undecided — without saying why", async () => {
    const reported = await makeStudent(c.a, { firstName: "Reported" });
    const report = (await Report.create({ reporter_id: u.a1, reported_user_id: reported, college_id: c.a, reason: "harassment", open_key: randomUUID() }))._id;

    expect(await ok(reported, "delete_my_account")).toBe("pending");
    expect(await ok(u.suspendedA, "delete_my_account")).toBe("pending");
    expect(await User.exists({ _id: reported })).not.toBeNull();
    expect(await Profile.exists({ _id: reported })).not.toBeNull();
    const mine = await ok(reported, "my_deletion_request");
    expect(Object.keys(mine).sort()).toEqual(["requested_at", "status"]); // never the reason: "there is a report about you" is not disclosed
    expect(mine.status).toBe("pending");
    expect(await ok(u.a1, "my_deletion_request")).toBeNull();
    expect(await ok(reported, "delete_my_account")).toBe("pending"); // asking again changes nothing
    expect(await AccountDeletionRequest.countDocuments({ _id: reported })).toBe(1);

    // Only the Super Admin sees and decides held requests.
    for (const who of [u.adminA, u.modA, u.a1, reported]) {
      expect(await refused(who, "admin_list_deletion_requests")).toBe("not_authorized");
      expect(await refused(who, "admin_complete_account_deletion", { p_user: reported })).toBe("not_authorized");
    }
    const held = await ok(u.superAdmin, "admin_list_deletion_requests");
    expect(held.map((row) => [row.first_name, row.hold_reason, row.open_reports]).sort()).toEqual([["Reported", "open_reports", 1], ["Sam", "suspended", 0]]);
    expect(await ok(u.superAdmin, "admin_inbox_counts")).toMatchObject({ deletion_requests: 2 });

    // Withdrawn by the student…
    await ok(u.suspendedA, "cancel_my_account_deletion");
    expect(await refused(u.suspendedA, "cancel_my_account_deletion")).toBe("no_deletion_request");
    expect(await refused(u.superAdmin, "admin_complete_account_deletion", { p_user: u.suspendedA })).toBe("no_deletion_request");
    // …and an admin cannot delete an account nobody asked to delete, a staff account, or their own.
    expect(await refused(u.superAdmin, "admin_complete_account_deletion", { p_user: u.a2 })).toBe("no_deletion_request");
    expect(await refused(u.superAdmin, "admin_complete_account_deletion", { p_user: u.superAdmin })).toBe("invalid_request");
    expect(await refused(u.superAdmin, "admin_complete_account_deletion", { p_user: "x" })).toBe("invalid_request");
    expect(await User.exists({ _id: u.a2 })).not.toBeNull();

    // Once the report is decided the student's own request goes through at once…
    await ok(u.modA, "admin_set_report_status", { p_report: report, p_status: "resolved", p_note: NOTE });
    expect(await ok(reported, "delete_my_account")).toBe("deleted");
    expect(await Report.findById(report).lean()).toMatchObject({ reported_user_id: null, status: "resolved", resolution_note: NOTE });
    expect(await ok(u.superAdmin, "admin_list_deletion_requests")).toEqual([]);
  });

  test("a held request can be completed by the Super Admin, and that is on the record", async () => {
    const held = await makeStudent(c.a, { firstName: "Held", status: "suspended" });
    expect(await ok(held, "delete_my_account")).toBe("pending");
    await ok(u.superAdmin, "admin_complete_account_deletion", { p_user: held });
    expect(await User.exists({ _id: held })).toBeNull();
    expect(await Profile.exists({ _id: held })).toBeNull();
    expect(await AccountDeletionRequest.findById(held).lean()).toMatchObject({ status: "completed", decided_by: "admin", hold_reason: "suspended" });
    const log = (await AuditLog.find({ target_id: held }).sort({ seq: 1 }).lean()).map((entry) => [entry.action, entry.actor_id, entry.metadata.by ?? null]);
    expect(log).toEqual([["accounts.deletion_requested", held, null], ["accounts.deleted", u.superAdmin, "admin"]]);
    expect(await refused(u.superAdmin, "admin_complete_account_deletion", { p_user: held })).toBe("no_deletion_request");
  });
});

describe("feedback", () => {
  test("any signed-in person may send it; validated; five a day; the sender is the caller", async () => {
    const sender = await makeStudent(c.b, { firstName: "Sender" });
    const send = (args, who = sender) => refused(who, "submit_feedback", { p_category: "bug", p_description: "The join button did nothing on my phone.", ...args });
    expect(await send({}, null)).toBe("not_authenticated");
    expect(await send({ p_category: "praise" })).toBe("invalid_feedback_category");
    expect(await send({ p_description: "too short" })).toBe("feedback_too_short");
    expect(await send({ p_description: "x".repeat(1001) })).toBe("feedback_too_long");
    expect(await send({ p_steps: "x".repeat(1001) })).toBe("feedback_too_long");
    expect(await Feedback.countDocuments({ user_id: sender })).toBe(0);

    expect(await send({ p_steps: "  Open the event, press Join.  ", user_id: u.a1, status: "reviewed", college_id: c.a })).toBeNull();
    expect(await Feedback.findOne({ user_id: sender }).lean()).toMatchObject({ category: "bug", steps: "Open the event, press Join.", status: "new", college_id: c.b });
    for (let i = 0; i < 4; i += 1) expect(await send({})).toBeNull();
    expect(await send({})).toBe("feedback_limit_reached");
    expect(await send({}, u.newcomer)).toBeNull(); // no profile needed
    expect(await send({}, u.adminA)).toBeNull();
  });

  test("only the Super Admin reads it, and the sender appears as a reference, never a name or address", async () => {
    for (const who of [u.adminA, u.modA, u.a1]) {
      expect(await refused(who, "admin_list_feedback")).toBe("not_authorized");
      expect(await refused(who, "admin_inbox_counts")).toBe("not_authorized");
    }
    const all = await ok(u.superAdmin, "admin_list_feedback", { p_limit: 100 });
    expect(all.length).toBeGreaterThanOrEqual(7);
    expect(all[0].total).toBe(all.length);
    expect(Object.keys(all[0]).sort()).toEqual(["category", "college_name", "created_at", "description", "feedback_id", "from_ref", "status", "steps", "total"]);
    expect(JSON.stringify(all)).not.toMatch(/@|Sender|user_id/);
    expect(all.some((row) => /^U-[0-9A-F]{8}$/.test(row.from_ref))).toBe(true);
    expect((await ok(u.superAdmin, "admin_list_feedback", { p_category: "idea" })).every((row) => row.category === "idea")).toBe(true);
    expect(await refused(u.superAdmin, "admin_list_feedback", { p_status: "x" })).toBe("invalid_request");

    const id = all[0].feedback_id;
    expect(await refused(u.adminA, "admin_set_feedback_reviewed", { p_feedback: id, p_reviewed: true })).toBe("not_authorized");
    expect(await refused(u.superAdmin, "admin_set_feedback_reviewed", { p_feedback: id, p_reviewed: "yes" })).toBe("invalid_request");
    expect(await refused(u.superAdmin, "admin_set_feedback_reviewed", { p_feedback: randomUUID(), p_reviewed: true })).toBe("feedback_not_found");
    const before = (await ok(u.superAdmin, "admin_inbox_counts")).feedback_new;
    await ok(u.superAdmin, "admin_set_feedback_reviewed", { p_feedback: id, p_reviewed: true });
    expect(await Feedback.findById(id).lean()).toMatchObject({ status: "reviewed", reviewed_by: u.superAdmin });
    expect((await ok(u.superAdmin, "admin_inbox_counts")).feedback_new).toBe(before - 1);
    expect((await ok(u.superAdmin, "admin_list_feedback", { p_status: "reviewed" })).map((row) => row.feedback_id)).toEqual([id]);
    await ok(u.superAdmin, "admin_set_feedback_reviewed", { p_feedback: id, p_reviewed: false });
    expect(await Feedback.findById(id).lean()).toMatchObject({ status: "new", reviewed_by: null, reviewed_at: null });
  });
});
