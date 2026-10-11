// Chat: who can open, read and write a conversation; idempotent sending; limits; block and report from a chat.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import * as chat from "@/lib/services/chat";
import { SERVICES } from "@/lib/services";
import { createWorld, makeEvent, makeStudent, match, models, ok, refused, testDatabase } from "./helpers";

const { AuditLog, Block, Match, Message, Profile, Report } = models;
const db = testDatabase("chat");
let c;
let u;
let event;
let conversation;
let matchId;
beforeAll(async () => {
  await db.start();
  ({ c, u } = await createWorld());
  event = await makeEvent(c.a);
  ({ conversation, matchId } = await match(event, u.a1, u.a2));
});
afterAll(() => db.stop());

const send = (who, body, id = randomUUID(), conv = conversation) => ok(who, "chat_send", { p_conversation: conv, p_body: body, p_client_id: id });
const sendRefused = (who, body, id = randomUUID(), conv = conversation) => refused(who, "chat_send", { p_conversation: conv, p_body: body, p_client_id: id });
const read = (who, args = {}, conv = conversation) => ok(who, "chat_messages", { p_conversation: conv, ...args });

async function freshPair(first = "Ravi", second = "Sita") {
  const ev = await makeEvent(c.a);
  const x = await makeStudent(c.a, { firstName: first, gender: "male" });
  const y = await makeStudent(c.a, { firstName: second, gender: "female" });
  return { x, y, ev, ...(await match(ev, x, y)) };
}

describe("access", () => {
  test("only the two matched students — not other students, not admins, not Super Admins", async () => {
    await send(u.a1, "Hello Bela");
    for (const outsider of [u.a3, u.b1, u.adminA, u.modA, u.superAdmin, u.newcomer]) {
      for (const name of ["chat_open", "chat_messages", "chat_latest_seq", "block_chat_partner"]) {
        expect(await refused(outsider, name, { p_conversation: conversation })).toBe("conversation_not_found");
      }
      expect(await sendRefused(outsider, "let me in")).toBe("conversation_not_found");
      expect(await refused(outsider, "report_chat_partner", { p_conversation: conversation, p_reason: "spam" })).toBe("conversation_not_found");
    }
    for (const name of ["chat_open", "chat_messages", "chat_latest_seq", "chat_send", "list_my_conversations"]) {
      expect(await refused(null, name, { p_conversation: conversation, p_body: "x", p_client_id: randomUUID() })).toBe("not_authenticated");
    }
    // The internal match id is not an address, and neither is nonsense.
    expect(await refused(u.a1, "chat_open", { p_conversation: matchId })).toBe("conversation_not_found");
    expect(await refused(u.a1, "chat_open", { p_conversation: "../../etc" })).toBe("conversation_not_found");
    expect(await refused(u.a1, "chat_open", { p_conversation: { $ne: null } })).toBe("conversation_not_found");
    expect(await Message.countDocuments({ match_id: matchId })).toBe(1);
  });

  test("the header and the list carry approved partner fields only", async () => {
    const header = await ok(u.a1, "chat_open", { p_conversation: conversation });
    expect(header).toMatchObject({ conversation, can_send: true, blocked_by_me: false, partner: { first_name: "Bela", has_photo: true } });
    expect(Object.keys(header.partner).sort()).toEqual(["course", "first_name", "handle", "has_photo", "study_year"]);
    const list = await ok(u.a2, "list_my_conversations");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ conversation, first_name: "Arjun", can_send: true, last_body: "Hello Bela", last_mine: false });
    const text = JSON.stringify([header, list]);
    for (const secret of [u.a1, u.a2, matchId]) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/email|date_of_birth|gender|avatar_path|sender_id/);
    expect(await ok(u.a2, "list_my_conversations", { p_event_id: event })).toHaveLength(1);
    expect(await ok(u.a2, "list_my_conversations", { p_event_id: randomUUID() })).toEqual([]);
    expect(await ok(u.a3, "list_my_conversations")).toEqual([]);
  });

  test("there is no way to make a conversation except by matching, and none to edit or delete a message", () => {
    const names = Object.keys(SERVICES).filter((name) => /chat|message|conversation/.test(name)).sort();
    expect(names).toEqual(["block_chat_partner", "chat_latest_seq", "chat_messages", "chat_open", "chat_send", "list_my_conversations", "report_chat_partner"]);
    expect(Object.keys(chat).filter((name) => /edit|update|delete|remove|create/i.test(name))).toEqual([]);
  });
});

describe("sending and reading", () => {
  test("the sender is the caller; text is stored as text; numbering is per conversation", async () => {
    const { x, y, conversation: conv, matchId: id } = await freshPair();
    const script = '<script>alert(1)</script> & "quotes" 😀\r\nsecond line\u0000\u0007';
    const [first] = await ok(x, "chat_send", { p_conversation: conv, p_body: script, p_client_id: randomUUID(), sender_id: y, seq: 99, created_at: "2001-01-01" });
    expect(first).toMatchObject({ seq: 1, mine: true, body: '<script>alert(1)</script> & "quotes" 😀\nsecond line' });
    expect(await Message.findOne({ match_id: id }).lean()).toMatchObject({ sender_id: x, seq: 1 });
    await ok(y, "chat_send", { p_conversation: conv, p_body: "  hi  ", p_client_id: randomUUID() });

    const seenByY = await read(y, {}, conv);
    expect(seenByY.map((m) => [m.seq, m.mine, m.body])).toEqual([[1, false, first.body], [2, true, "hi"]]);
    expect(seenByY[0].client_id).toBeNull(); // the other person's client id is not shared
    expect(seenByY[1].client_id).not.toBeNull();
    expect(Object.keys(seenByY[0]).sort()).toEqual(["body", "client_id", "created_at", "mine", "seq"]);
    expect(await ok(y, "chat_latest_seq", { p_conversation: conv })).toBe(2);
  });

  test("empty, invisible-only and over-long messages are refused", async () => {
    expect(await sendRefused(u.a1, "")).toBe("message_empty");
    expect(await sendRefused(u.a1, "   \n\t ")).toBe("message_empty");
    expect(await sendRefused(u.a1, "​‍﻿")).toBe("message_empty");
    expect(await sendRefused(u.a1, "x".repeat(2001))).toBe("message_too_long");
    expect(await sendRefused(u.a1, "x".repeat(2000))).toBeNull();
    expect(await sendRefused(u.a1, "😀".repeat(2000))).toBeNull(); // counted in characters, not bytes
    expect(await sendRefused(u.a1, "fine", "not-a-uuid")).toBe("invalid_request");
    expect(await sendRefused(u.a1, { $gt: "" })).toBe("invalid_request");
  });

  test("a double press or a retry stores one message", async () => {
    const { x, conversation: conv, matchId: id } = await freshPair("Tarun", "Uma");
    const clientId = randomUUID();
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => ok(x, "chat_send", { p_conversation: conv, p_body: "once", p_client_id: clientId })));
    expect(new Set(results.map(([m]) => m.seq)).size).toBe(1);
    expect(await Message.countDocuments({ match_id: id })).toBe(1);
    const [again] = await ok(x, "chat_send", { p_conversation: conv, p_body: "a different text, same id", p_client_id: clientId.toUpperCase() });
    expect(again.body).toBe("once");
    expect(await Message.countDocuments({ match_id: id })).toBe(1);
  });

  test("simultaneous senders get distinct, gap-free numbers", async () => {
    const { x, y, conversation: conv, matchId: id } = await freshPair("Varun", "Wini");
    await Promise.all(Array.from({ length: 16 }, (_, i) => ok(i % 2 ? x : y, "chat_send", { p_conversation: conv, p_body: `m${i}`, p_client_id: randomUUID() })));
    const seqs = (await Message.find({ match_id: id }).lean()).map((m) => m.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect((await Match.findById(id).lean()).last_seq).toBe(16);
  });

  test("history is paged and bounded", async () => {
    const { x, y, conversation: conv, matchId: id } = await freshPair("Yash", "Zoya");
    await Message.insertMany(Array.from({ length: 120 }, (_, i) => ({ match_id: id, sender_id: i % 2 ? x : y, body: `n${i + 1}`, client_id: randomUUID(), seq: i + 1 })));
    await Match.updateOne({ _id: id }, { $set: { last_seq: 120 } });

    const latest = await read(x, {}, conv);
    expect(latest.map((m) => m.seq)).toEqual(Array.from({ length: 30 }, (_, i) => 91 + i));
    const older = await read(x, { p_before: 91, p_limit: 10 }, conv);
    expect(older.map((m) => m.seq)).toEqual([81, 82, 83, 84, 85, 86, 87, 88, 89, 90]);
    expect((await read(x, { p_after: 118 }, conv)).map((m) => m.seq)).toEqual([119, 120]);
    expect(await read(x, { p_after: 120 }, conv)).toEqual([]);
    expect(await read(x, { p_limit: 100000 }, conv)).toHaveLength(101);
    expect(await read(x, { p_limit: -3 }, conv)).toHaveLength(1);
    expect(await read(x, { p_before: "5; drop" }, conv)).toHaveLength(30); // not a number: ignored
  });

  test("20 messages a minute per sender", async () => {
    const { x, y, conversation: conv, matchId: id } = await freshPair("Anil", "Bina");
    await Message.insertMany(Array.from({ length: 20 }, (_, i) => ({ match_id: id, sender_id: x, body: "fast", client_id: randomUUID(), seq: i + 1 })));
    await Match.updateOne({ _id: id }, { $set: { last_seq: 20 } });
    expect(await refused(x, "chat_send", { p_conversation: conv, p_body: "one more", p_client_id: randomUUID() })).toBe("message_rate_limited");
    expect(await refused(y, "chat_send", { p_conversation: conv, p_body: "my own allowance", p_client_id: randomUUID() })).toBeNull();
  });
});

describe("blocks and suspensions", () => {
  test("after a block neither can send; both can still read; the reason is not revealed", async () => {
    const { x, y, conversation: conv, matchId: id } = await freshPair("Chirag", "Dipa");
    await ok(x, "chat_send", { p_conversation: conv, p_body: "before", p_client_id: randomUUID() });
    await ok(y, "block_chat_partner", { p_conversation: conv });
    await ok(y, "block_chat_partner", { p_conversation: conv });
    expect(await Block.countDocuments({ blocker_id: y, blocked_id: x })).toBe(1);

    for (const who of [x, y]) expect(await refused(who, "chat_send", { p_conversation: conv, p_body: "after", p_client_id: randomUUID() })).toBe("messaging_unavailable");
    expect(await Message.countDocuments({ match_id: id })).toBe(1);
    expect(await read(x, {}, conv)).toHaveLength(1);
    expect(await ok(x, "chat_open", { p_conversation: conv })).toMatchObject({ can_send: false, blocked_by_me: false, partner: { has_photo: false } });
    expect(await ok(y, "chat_open", { p_conversation: conv })).toMatchObject({ can_send: false, blocked_by_me: true });
    expect((await ok(x, "list_my_conversations"))[0]).toMatchObject({ can_send: false, blocked_by_me: false, has_photo: false });
  });

  test("a suspended student cannot open anything; the partner can read but not send", async () => {
    const { x, y, conversation: conv } = await freshPair("Eshan", "Farah");
    await ok(x, "chat_send", { p_conversation: conv, p_body: "hello", p_client_id: randomUUID() });
    await Profile.updateOne({ _id: x }, { $set: { status: "suspended" } });
    for (const name of ["chat_open", "chat_messages", "chat_latest_seq"]) expect(await refused(x, name, { p_conversation: conv })).toBe("account_suspended");
    expect(await refused(x, "chat_send", { p_conversation: conv, p_body: "hi", p_client_id: randomUUID() })).toBe("account_suspended");
    expect(await refused(x, "list_my_conversations")).toBe("account_suspended");
    expect(await read(y, {}, conv)).toHaveLength(1);
    expect(await refused(y, "chat_send", { p_conversation: conv, p_body: "hi", p_client_id: randomUUID() })).toBe("messaging_unavailable");
    expect((await ok(y, "chat_open", { p_conversation: conv })).can_send).toBe(false);
    await Profile.updateOne({ _id: x }, { $set: { status: "active" } });
    expect(await refused(y, "chat_send", { p_conversation: conv, p_body: "back", p_client_id: randomUUID() })).toBeNull();
  });

  test("an ended match is read-only", async () => {
    const { x, conversation: conv, matchId: id } = await freshPair("Gopal", "Hina");
    await Match.updateOne({ _id: id }, { $set: { status: "ended" } });
    expect(await refused(x, "chat_send", { p_conversation: conv, p_body: "hi", p_client_id: randomUUID() })).toBe("messaging_unavailable");
    expect(await read(x, {}, conv)).toEqual([]);
  });
});

describe("reporting from a chat", () => {
  test("messages reach a moderator only when the reporter attaches them — at most the latest 20", async () => {
    const { x, y, ev, conversation: conv, matchId: id } = await freshPair("Irfan", "Juhi");
    await Message.insertMany(Array.from({ length: 25 }, (_, i) => ({ match_id: id, sender_id: i % 2 ? x : y, body: `line ${i + 1}`, client_id: randomUUID(), seq: i + 1 })));
    await Match.updateOne({ _id: id }, { $set: { last_seq: 25 } });
    const report = (args) => refused(y, "report_chat_partner", { p_conversation: conv, p_reason: "harassment", ...args });

    expect(await report({ p_reason: "misleading_information" })).toBe("invalid_report_reason"); // a profile-only reason
    expect(await report({ p_details: "x".repeat(1001) })).toBe("report_details_too_long");
    expect(await ok(y, "report_chat_partner", { p_conversation: conv, p_reason: "threats", p_details: "Said he would find me.", p_include_messages: true })).toBe("reported");
    const stored = await Report.findOne({ reporter_id: y }).lean();
    expect(stored).toMatchObject({ reported_user_id: x, college_id: c.a, event_id: ev, match_id: id, reason: "threats", status: "open" });
    expect(stored.evidence).toHaveLength(20);
    expect(stored.evidence[0]).toMatchObject({ seq: 6, body: "line 6", from: "reported" });
    expect(stored.evidence[19]).toMatchObject({ seq: 25, body: "line 25", from: "reporter" });
    expect(JSON.stringify(stored.evidence)).not.toContain(x);
    expect(await ok(y, "report_chat_partner", { p_conversation: conv, p_reason: "spam" })).toBe("already_reported");

    // The other direction is a separate report; without the tick nothing is attached.
    expect(await ok(x, "report_chat_partner", { p_conversation: conv, p_reason: "spam", p_include_messages: "true" })).toBe("reported");
    expect((await Report.findOne({ reporter_id: x }).lean()).evidence).toBeNull();
    // Reporting is not logged as an admin action and tells the reported person nothing.
    expect(await AuditLog.countDocuments({ target_id: stored._id })).toBe(0);
    expect(JSON.stringify(await ok(x, "chat_open", { p_conversation: conv }))).not.toMatch(/report/i);
  });
});
