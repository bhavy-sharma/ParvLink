// Phase 4 — the pure parts of chat: keeping the message list ordered and free
// of duplicates, input validation, wording.
import { describe, expect, test } from "vitest";
import { describeDbError } from "@/lib/auth/errors";
import { chatPath, isProtectedPath, safeNextPath } from "@/lib/auth/routes";
import { earliestSeq, latestSeq, mergeMessages, newClientId, splitPage, withoutConfirmed } from "@/lib/chat/messages";
import { CHAT_PAGE_SIZE, CHAT_REPORT_REASONS, MESSAGE_MAX } from "@/lib/validation/limits";
import { cleanMessageBody, conversationSchema, loadMessagesSchema, reportChatSchema, sendMessageSchema } from "@/lib/validation/schemas";

const CONVERSATION = "3f2b8c1e-5a4d-4e6f-9a7b-0c1d2e3f4a5b";
const CLIENT = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";
const msg = (seq, extra = {}) => ({ seq, body: `m${seq}`, created_at: "2026-10-10T10:00:00Z", mine: false, client_id: null, ...extra });

describe("mergeMessages", () => {
  test("adds new messages in order, whatever order they arrive in", () => {
    const merged = mergeMessages([msg(3), msg(4)], [msg(6), msg(5), msg(1)]);
    expect(merged.map((m) => m.seq)).toEqual([1, 3, 4, 5, 6]);
  });

  test("a message that arrives twice — reply to a send, then the live catch-up — is kept once", () => {
    const afterSend = mergeMessages([msg(1)], [msg(2, { mine: true, client_id: CLIENT })]);
    const afterCatchUp = mergeMessages(afterSend, [msg(2, { mine: true, client_id: CLIENT }), msg(3)]);
    expect(afterCatchUp.map((m) => m.seq)).toEqual([1, 2, 3]);
  });

  test("returns the very same array when there is nothing new, so the screen does not re-render or scroll", () => {
    const list = [msg(1), msg(2)];
    expect(mergeMessages(list, [])).toBe(list);
    expect(mergeMessages(list, null)).toBe(list);
    expect(mergeMessages(list, [msg(2), msg(1)])).toBe(list);
  });

  test("older pages go in front; overlapping pages do not duplicate", () => {
    const merged = mergeMessages([msg(31), msg(32)], [msg(29), msg(30), msg(31)]);
    expect(merged.map((m) => m.seq)).toEqual([29, 30, 31, 32]);
  });

  test("ignores rows without a usable seq", () => {
    const list = [msg(1)];
    expect(mergeMessages(list, [null, {}, { seq: "2" }, { seq: 1.5 }])).toBe(list);
  });

  test("cursors", () => {
    expect(latestSeq([])).toBe(0);
    expect(earliestSeq([])).toBeNull();
    expect(latestSeq([msg(4), msg(9)])).toBe(9);
    expect(earliestSeq([msg(4), msg(9)])).toBe(4);
  });
});

describe("drafts and pages", () => {
  test("a draft disappears once the server's copy (same client id) is in the list", () => {
    const drafts = [{ clientId: CLIENT, body: "hi", status: "sending" }, { clientId: "other", body: "yo", status: "failed" }];
    const remaining = withoutConfirmed(drafts, [msg(1), msg(2, { mine: true, client_id: CLIENT })]);
    expect(remaining.map((d) => d.clientId)).toEqual(["other"]);
    expect(withoutConfirmed(drafts, [msg(1)])).toBe(drafts);
    expect(withoutConfirmed([], [msg(1)])).toEqual([]);
  });

  test("splitPage: one extra row means there are earlier messages; the extra (oldest) row is dropped", () => {
    const rows = Array.from({ length: CHAT_PAGE_SIZE + 1 }, (_, i) => msg(i + 10));
    const page = splitPage(rows, CHAT_PAGE_SIZE);
    expect(page.hasEarlier).toBe(true);
    expect(page.messages).toHaveLength(CHAT_PAGE_SIZE);
    expect(page.messages[0].seq).toBe(11);
    expect(splitPage(rows.slice(1), CHAT_PAGE_SIZE)).toEqual({ messages: rows.slice(1), hasEarlier: false });
    expect(splitPage([], CHAT_PAGE_SIZE)).toEqual({ messages: [], hasEarlier: false });
  });

  test("newClientId gives distinct v4 UUIDs", () => {
    const ids = new Set(Array.from({ length: 200 }, newClientId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("sendMessageSchema", () => {
  const parse = (body, extra = {}) => sendMessageSchema.safeParse({ conversation: CONVERSATION, clientId: CLIENT, body, ...extra });

  test("accepts ordinary text and trims around it, keeping line breaks inside", () => {
    const result = parse("  Hello\r\nthere 🙂 \n");
    expect(result.success).toBe(true);
    expect(result.data.body).toBe("Hello\nthere 🙂");
  });

  test.each(["", "   ", "\n\t\r\n", "​​", " ﻿⁠ ", null, undefined, 42, {}])("rejects blank or non-text %j", (body) => {
    expect(parse(body).success).toBe(false);
  });

  test("the limit is counted in characters, after trimming", () => {
    expect(parse(`  ${"é".repeat(MESSAGE_MAX)}  `).success).toBe(true);
    expect(parse("🙂".repeat(MESSAGE_MAX)).success).toBe(true); // 2000 characters, 4000 UTF-16 units
    const tooLong = parse("x".repeat(MESSAGE_MAX + 1));
    expect(tooLong.success).toBe(false);
    expect(tooLong.error.issues[0].message).toContain("too long");
  });

  test("markup is not altered (it is displayed as text, never as HTML); control characters are dropped", () => {
    expect(parse(`<script>alert(1)</script>`).data.body).toBe(`<script>alert(1)</script>`);
    expect(cleanMessageBody("a\u0007b\u001Bc\u007F")).toBe("abc");
  });

  test("needs a real conversation id and client id, and has no field for a sender", () => {
    expect(parse("hi", { conversation: "not-an-id" }).success).toBe(false);
    expect(parse("hi", { conversation: "" }).success).toBe(false);
    expect(parse("hi", { clientId: "1" }).success).toBe(false);
    const result = parse("hi", { senderId: CLIENT, sender_id: CLIENT, matchId: CLIENT });
    expect(Object.keys(result.data).sort()).toEqual(["body", "clientId", "conversation"]);
  });
});

describe("other chat inputs", () => {
  test("conversation ids must be UUIDs", () => {
    expect(conversationSchema.safeParse({ conversation: CONVERSATION }).success).toBe(true);
    for (const bad of ["", "abc", "../admin", `${CONVERSATION}/x`, null]) expect(conversationSchema.safeParse({ conversation: bad }).success).toBe(false);
  });

  test("paging accepts one cursor at most, and only whole non-negative numbers", () => {
    const ok = (extra) => loadMessagesSchema.safeParse({ conversation: CONVERSATION, ...extra }).success;
    expect(ok({})).toBe(true);
    expect(ok({ before: 31 })).toBe(true);
    expect(ok({ after: 0 })).toBe(true);
    expect(ok({ before: null, after: 12 })).toBe(true);
    expect(ok({ before: 5, after: 2 })).toBe(false);
    for (const bad of [-1, 1.5, "7", Number.NaN, 2 ** 40]) expect(ok({ after: bad }), String(bad)).toBe(false);
  });

  test("report: a listed reason is required; the description is optional and limited; sharing messages is opt-in", () => {
    const parse = (extra) => reportChatSchema.safeParse({ conversation: CONVERSATION, reason: "threats", details: "", includeMessages: "", ...extra });
    expect(parse({}).data).toEqual({ conversation: CONVERSATION, reason: "threats", details: null, includeMessages: false });
    expect(parse({ includeMessages: "on" }).data.includeMessages).toBe(true);
    expect(parse({ details: "  What happened.  " }).data.details).toBe("What happened.");
    expect(parse({ reason: "" }).success).toBe(false);
    expect(parse({ reason: "misleading_information" }).success).toBe(false); // a Phase 3 profile reason, not offered in chat
    expect(parse({ details: "x".repeat(1001) }).success).toBe(false);
    expect(CHAT_REPORT_REASONS.map((r) => r.label)).toEqual([
      "Harassment or abusive messages",
      "Threats or intimidation",
      "Spam or scam",
      "Fake or misleading profile",
      "Inappropriate content",
      "Other",
    ]);
  });

  test("chat pages are behind the sign-in gate, and are valid places to return to after logging in", () => {
    expect(chatPath(CONVERSATION)).toBe(`/matches/${CONVERSATION}`);
    expect(isProtectedPath(chatPath(CONVERSATION))).toBe(true);
    expect(safeNextPath(chatPath(CONVERSATION))).toBe(chatPath(CONVERSATION));
  });

  test("database refusals become neutral sentences — none mentions a block or the other person", () => {
    const codes = ["conversation_not_found", "messaging_unavailable", "message_empty", "message_too_long", "message_rate_limited"];
    for (const code of codes) {
      const text = describeDbError({ code: "P0001", message: code });
      expect(text, code).not.toContain("Something went wrong");
      expect(text, code).not.toMatch(/block|suspend|report/i);
    }
    expect(describeDbError({ code: "P0001", message: "messaging_unavailable" })).toBe("Messaging is unavailable in this conversation.");
  });
});
