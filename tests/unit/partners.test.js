import { describe, expect, test } from "vitest";
import { describeDbError } from "@/lib/auth/errors";
import { eventPaths, isProtectedPath } from "@/lib/auth/routes";
import { blockerSentences, describeParticipationError, participationState, partnerLabel } from "@/lib/partners";
import { blockIdSchema, eventProfileSchema, joinEventSchema, partnerSchema, reportPartnerSchema } from "@/lib/validation/schemas";

const HANDLE = "3f2b8c1e-5a4d-4e6f-9a7b-0c1d2e3f4a5b";
const ok = (schema, input) => schema.safeParse(input).success;

describe("partner-finding input validation", () => {
  test("join: preference required; gender optional and limited to the two stored values", () => {
    expect(joinEventSchema.parse({ slug: "dandiya-night-ab12cd", lookingFor: "female", gender: "" })).toEqual({ slug: "dandiya-night-ab12cd", lookingFor: "female", gender: null });
    expect(joinEventSchema.parse({ slug: "x-1", lookingFor: "male", gender: "female" }).gender).toBe("female");
    for (const bad of [{ lookingFor: "" }, { lookingFor: "anyone" }, { gender: "other" }, { slug: "../admin" }, { slug: "Has Spaces" }]) {
      expect(ok(joinEventSchema, { slug: "x-1", lookingFor: "male", gender: "", ...bad }), JSON.stringify(bad)).toBe(false);
    }
  });

  test("extra fields such as a user id or status never survive parsing", () => {
    const parsed = joinEventSchema.parse({ slug: "x-1", lookingFor: "male", gender: "", userId: HANDLE, user_id: HANDLE, status: "active", eventId: HANDLE });
    expect(Object.keys(parsed).sort()).toEqual(["gender", "lookingFor", "slug"]);
    expect(Object.keys(partnerSchema.parse({ slug: "x-1", handle: HANDLE, toUserId: HANDLE, state: "matched" })).sort()).toEqual(["handle", "slug"]);
  });

  test("a person is addressed by a handle, which must be a uuid", () => {
    expect(ok(partnerSchema, { slug: "x-1", handle: HANDLE })).toBe(true);
    for (const handle of ["", "me", "1 or 1=1", `${HANDLE}/../x`]) expect(ok(partnerSchema, { slug: "x-1", handle }), handle).toBe(false);
    expect(ok(blockIdSchema, { blockId: HANDLE })).toBe(true);
    expect(ok(blockIdSchema, { blockId: "all" })).toBe(false);
  });

  test("open/close accepts only an explicit true or false", () => {
    expect(eventProfileSchema.parse({ slug: "x-1", open: "true" }).open).toBe(true);
    expect(eventProfileSchema.parse({ slug: "x-1", open: "false" }).open).toBe(false);
    for (const open of ["", "yes", "1", undefined]) expect(ok(eventProfileSchema, { slug: "x-1", open })).toBe(false);
  });

  test("report: one of five reasons, optional description up to 1000 characters", () => {
    const base = { slug: "x-1", handle: HANDLE };
    expect(reportPartnerSchema.parse({ ...base, reason: "misleading_information", details: "  " }).details).toBeNull();
    expect(reportPartnerSchema.parse({ ...base, reason: "spam", details: " line one\r\nline two " }).details).toBe("line one\nline two");
    for (const reason of ["fake_profile", "harassment", "misleading_information", "spam", "other"]) expect(ok(reportPartnerSchema, { ...base, reason, details: "" }), reason).toBe(true);
    for (const reason of ["", "inappropriate_content", "because"]) expect(ok(reportPartnerSchema, { ...base, reason, details: "" }), reason).toBe(false);
    expect(ok(reportPartnerSchema, { ...base, reason: "spam", details: "x".repeat(1001) })).toBe(false);
  });
});

describe("participation state shown to the student", () => {
  test("not joined, active, closed and ended", () => {
    expect(participationState(null)).toBe("not_joined");
    expect(participationState({ joined: false, blockers: [] })).toBe("not_joined");
    expect(participationState({ joined: true, status: "active", blockers: [] })).toBe("active");
    expect(participationState({ joined: true, status: "closed", blockers: [] })).toBe("closed");
    // joined, but the event closed or eligibility was lost: "ended", whatever the stored status
    expect(participationState({ joined: true, status: "active", blockers: ["event_closed"] })).toBe("ended");
    expect(participationState({ joined: true, status: "closed", blockers: ["event_completed"] })).toBe("ended");
  });

  test("reasons from the database become plain sentences; unknown codes get a generic one", () => {
    expect(blockerSentences(["photo_missing", "year_not_eligible"])).toEqual([
      "Add a profile photo. Partners need to see who they are teaming up with.",
      "This event is limited to other years of study.",
    ]);
    expect(blockerSentences(["something_new"])).toEqual(["A requirement for this event is not met."]);
    expect(describeParticipationError({ message: "participation_blocked", details: "event_closed" })).toBe("The organisers have closed this event to new participants.");
    expect(describeParticipationError({ message: "participation_blocked" })).toBe("You cannot take part in this event right now.");
  });

  test("the same message for every reason a partner is unavailable (closed, blocked, ineligible, unknown)", () => {
    expect(describeDbError({ code: "P0001", message: "partner_not_available" })).toBe("That person is no longer available for this event.");
  });

  test("labels and paths", () => {
    expect(partnerLabel("male")).toBe("a male partner");
    expect(partnerLabel("female")).toBe("a female partner");
    const paths = eventPaths("dandiya-ab12cd");
    expect(paths.partners).toBe("/events/dandiya-ab12cd/partners");
    expect(paths.photo(HANDLE)).toBe(`/events/dandiya-ab12cd/partners/photo/${HANDLE}`);
    for (const path of [paths.join, paths.partners, paths.photo(HANDLE), "/matches"]) expect(isProtectedPath(path), path).toBe(true);
  });
});
