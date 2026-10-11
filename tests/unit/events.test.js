import { describe, expect, test } from "vitest";
import { dateToZonedInput, formatEventRange, zonedInputToDate } from "@/lib/dates";
import { BLOCKER_MESSAGES, describeEligibility, eventPhase, eventToFormValues, isAllowedTransition, STATUS_ACTIONS } from "@/lib/events";
import { EVENT_STATUS_VALUES } from "@/lib/validation/limits";
import { parseEventForm } from "@/lib/validation/schemas";

const HOST = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-10-10T06:00:00Z");

describe("event date-times (typed in Asia/Kolkata, stored in UTC)", () => {
  test("converts a typed local time to the right instant and back", () => {
    expect(zonedInputToDate("2026-10-17T19:30").toISOString()).toBe("2026-10-17T14:00:00.000Z");
    expect(zonedInputToDate("2026-01-01T00:15").toISOString()).toBe("2025-12-31T18:45:00.000Z");
    expect(dateToZonedInput("2026-10-17T14:00:00Z")).toBe("2026-10-17T19:30");
    for (const value of ["2026-10-17T19:30", "2027-02-28T23:59", "2028-02-29T00:00"]) {
      expect(dateToZonedInput(zonedInputToDate(value))).toBe(value);
    }
  });

  test("handles zones with daylight saving", () => {
    expect(zonedInputToDate("2026-07-01T12:00", "Europe/London").toISOString()).toBe("2026-07-01T11:00:00.000Z");
    expect(zonedInputToDate("2026-12-01T12:00", "Europe/London").toISOString()).toBe("2026-12-01T12:00:00.000Z");
    expect(dateToZonedInput("2026-07-01T11:00:00Z", "Europe/London")).toBe("2026-07-01T12:00");
  });

  test("rejects things that are not date-times", () => {
    for (const bad of ["", "tomorrow", "2026-02-30T10:00", "2026-10-17T25:00", "2026-10-17", null, 5]) {
      expect(zonedInputToDate(bad), String(bad)).toBeNull();
    }
    expect(dateToZonedInput(null)).toBe("");
    expect(dateToZonedInput("garbage")).toBe("");
  });

  test("formats a same-day range compactly", () => {
    expect(formatEventRange("2026-10-17T14:00:00Z", "2026-10-17T17:30:00Z")).toMatch(/^Sat, 17 Oct,? 2026,? 7:30\s?pm – 11:00\s?pm$/i);
    expect(formatEventRange("2026-10-17T14:00:00Z", "2026-10-19T10:00:00Z")).toMatch(/17 Oct.*–.*19 Oct/);
  });
});

describe("event form validation", () => {
  const valid = {
    title: "  Navratri   Dandiya Night ",
    eventType: "dandiya_night",
    collegeId: HOST,
    description: "Garba and dandiya on the main lawn.",
    venue: "Main lawn",
    startsAt: "2026-10-17T19:30",
    endsAt: "2026-10-17T23:00",
    registrationOpensAt: "",
    registrationClosesAt: "",
    minimumAge: "18",
    collegesMode: "host",
    collegeIds: [],
    courses: "",
    studyYears: [],
    requirements: "",
  };
  const parse = (overrides = {}, options = { mode: "create" }) => parseEventForm({ ...valid, ...overrides }, { now, ...options });

  test("builds the database row, including canonical eligibility rules", () => {
    const result = parse();
    expect(result.success).toBe(true);
    expect(result.collegeId).toBe(HOST);
    expect(result.row).toEqual({
      title: "Navratri Dandiya Night",
      event_type: "dandiya_night",
      description: "Garba and dandiya on the main lawn.",
      venue: "Main lawn",
      starts_at: "2026-10-17T14:00:00.000Z",
      ends_at: "2026-10-17T17:30:00.000Z",
      registration_opens_at: null,
      registration_closes_at: null,
      minimum_age: 18,
      eligibility_rules: { colleges: { mode: "selected", ids: [HOST] }, courses: [], study_years: [] },
      requirements: null,
    });
  });

  test("the row never contains server-owned fields, whatever is posted", () => {
    const result = parse({ status: "published", created_by: OTHER, slug: "mine", published_at: "2020-01-01", id: OTHER, role: "super_admin" });
    expect(Object.keys(result.row).sort()).toEqual([
      "description", "eligibility_rules", "ends_at", "event_type", "minimum_age", "registration_closes_at",
      "registration_opens_at", "requirements", "starts_at", "title", "venue",
    ]);
  });

  test("eligibility options", () => {
    expect(parse({ collegesMode: "all", collegeIds: [OTHER] }).row.eligibility_rules.colleges).toEqual({ mode: "all" });
    expect(parse({ collegesMode: "selected", collegeIds: [OTHER, OTHER] }).row.eligibility_rules.colleges).toEqual({ mode: "selected", ids: [HOST, OTHER] });
    expect(parse({ collegesMode: "host", collegeIds: [OTHER] }).row.eligibility_rules.colleges).toEqual({ mode: "selected", ids: [HOST] });
    const rules = parse({ courses: "B.Tech, MBA\n b.tech \n\nM.Sc  Physics", studyYears: ["3", "1", "3"] }).row.eligibility_rules;
    expect(rules.courses).toEqual(["B.Tech", "MBA", "M.Sc Physics"]);
    expect(rules.study_years).toEqual([1, 3]);
  });

  test("when editing, the host college comes from the stored event, not the form", () => {
    const result = parse({ collegeId: OTHER, collegesMode: "host" }, { mode: "edit", hostCollegeId: HOST, currentStatus: "published" });
    expect(result.collegeId).toBe(HOST);
    expect(result.row.eligibility_rules.colleges.ids).toEqual([HOST]);
  });

  test.each([
    ["missing title", { title: " " }, "title"],
    ["markup in the title", { title: "<script>alert(1)</script>" }, "title"],
    ["unknown type", { eventType: "rave" }, "eventType"],
    ["missing host college", { collegeId: "" }, "collegeId"],
    ["short description", { description: "Fun." }, "description"],
    ["missing venue", { venue: "" }, "venue"],
    ["missing start", { startsAt: "" }, "startsAt"],
    ["impossible date", { startsAt: "2026-02-30T10:00" }, "startsAt"],
    ["end before start", { endsAt: "2026-10-17T18:00" }, "endsAt"],
    ["end equal to start", { endsAt: "2026-10-17T19:30" }, "endsAt"],
    ["event already over", { startsAt: "2026-10-01T10:00", endsAt: "2026-10-01T12:00" }, "endsAt"],
    ["window closes before it opens", { registrationOpensAt: "2026-10-12T10:00", registrationClosesAt: "2026-10-11T10:00" }, "registrationClosesAt"],
    ["window closes after the event", { registrationClosesAt: "2026-10-18T10:00" }, "registrationClosesAt"],
    ["window opens after the event", { registrationOpensAt: "2026-10-18T10:00" }, "registrationOpensAt"],
    ["minimum age below 18", { minimumAge: "17" }, "minimumAge"],
    ["minimum age not a number", { minimumAge: "adult" }, "minimumAge"],
    ["unknown colleges option", { collegesMode: "everyone" }, "collegesMode"],
    ["'selected' with nothing selected", { collegesMode: "selected", collegeIds: [] }, "collegeIds"],
    ["a selected college that is not an id", { collegesMode: "selected", collegeIds: ["1 or 1=1"] }, "collegeIds"],
    ["a year outside 1–6", { studyYears: ["7"] }, "studyYears"],
    ["a one-letter course", { courses: "X" }, "courses"],
    ["requirements too long", { requirements: "x".repeat(2001) }, "requirements"],
  ])("rejects: %s", (_label, overrides, field) => {
    const result = parse(overrides);
    expect(result.success).toBe(false);
    expect(result.fieldErrors[field]).toBeTruthy();
  });

  test("a published event may be edited after it has started; a draft still needs a future end", () => {
    const past = { startsAt: "2026-10-01T10:00", endsAt: "2026-10-01T12:00" };
    expect(parse(past, { mode: "edit", hostCollegeId: HOST, currentStatus: "published" }).success).toBe(true);
    expect(parse(past, { mode: "edit", hostCollegeId: HOST, currentStatus: "draft" }).success).toBe(false);
  });
});

describe("what students see", () => {
  const event = (overrides = {}) => ({
    status: "published",
    starts_at: "2026-10-17T14:00:00Z",
    ends_at: "2026-10-17T17:30:00Z",
    registration_opens_at: null,
    registration_closes_at: null,
    ...overrides,
  });

  test("phase follows status first, then the clock", () => {
    expect(eventPhase(event({ status: "draft" }), now)).toBe("draft");
    expect(eventPhase(event(), now)).toBe("open");
    expect(eventPhase(event({ registration_opens_at: "2026-10-12T00:00:00Z" }), now)).toBe("upcoming");
    expect(eventPhase(event({ registration_closes_at: "2026-10-09T00:00:00Z" }), now)).toBe("closed");
    expect(eventPhase(event({ status: "closed" }), now)).toBe("closed");
    expect(eventPhase(event({ status: "completed" }), now)).toBe("completed");
    expect(eventPhase(event(), new Date("2026-10-18T00:00:00Z"))).toBe("completed"); // ended, not yet marked
    expect(eventPhase(event({ status: "closed" }), new Date("2026-10-18T00:00:00Z"))).toBe("completed");
  });

  test("eligibility reads in plain language, host college first", () => {
    const names = new Map([[HOST, "Ruia College"], [OTHER, "Bhavans College"]]);
    const lines = describeEligibility(
      { college_id: HOST, minimum_age: 21, eligibility_rules: { colleges: { mode: "selected", ids: [OTHER, HOST, "33333333-3333-4333-8333-333333333333"] }, courses: ["B.Tech", "MBA"], study_years: [1, 3] } },
      names,
    );
    expect(lines).toEqual([
      { label: "Colleges", text: "Students of Ruia College, Bhavans College or 1 other college." },
      { label: "Age", text: "21 or older on the day of the event." },
      { label: "Courses", text: "B.Tech or MBA." },
      { label: "Years", text: "1st year or 3rd year." },
    ]);
    expect(describeEligibility({ college_id: HOST, minimum_age: 18, eligibility_rules: { colleges: { mode: "all" }, courses: [], study_years: [] } }, names)).toEqual([
      { label: "Colleges", text: "Students of every college on ParvLink." },
      { label: "Age", text: "18 or older on the day of the event." },
    ]);
  });

  test("every reason the database can give has a message", () => {
    const codes = ["no_profile", "profile_suspended", "photo_missing", "college_not_invited", "under_age", "course_not_eligible", "year_not_eligible", "event_not_published", "event_completed", "event_closed", "registration_not_open", "registration_closed"];
    for (const code of codes) expect(BLOCKER_MESSAGES[code]?.text, code).toBeTruthy();
  });
});

describe("admin status changes", () => {
  test("only the documented transitions are offered", () => {
    const allowed = [["draft", "published"], ["published", "closed"], ["published", "completed"], ["closed", "published"], ["closed", "completed"]];
    for (const from of EVENT_STATUS_VALUES) {
      for (const to of EVENT_STATUS_VALUES) {
        expect(isAllowedTransition(from, to), `${from} → ${to}`).toBe(allowed.some(([a, b]) => a === from && b === to));
      }
    }
    expect(STATUS_ACTIONS.completed).toEqual([]);
    expect(isAllowedTransition("draft", "deleted")).toBe(false);
  });

  test("an event round-trips into the edit form", () => {
    const values = eventToFormValues({
      title: "Fest", event_type: "college_fest", college_id: HOST, description: "d", venue: "v",
      starts_at: "2026-10-17T14:00:00Z", ends_at: "2026-10-17T17:30:00Z", registration_opens_at: null, registration_closes_at: "2026-10-16T12:30:00Z",
      minimum_age: 19, requirements: null,
      eligibility_rules: { colleges: { mode: "selected", ids: [HOST, OTHER] }, courses: ["B.Tech", "MBA"], study_years: [1, 3] },
    });
    expect(values).toMatchObject({
      startsAt: "2026-10-17T19:30", endsAt: "2026-10-17T23:00", registrationOpensAt: "", registrationClosesAt: "2026-10-16T18:00",
      minimumAge: "19", collegesMode: "selected", collegeIds: [OTHER], courses: "B.Tech\nMBA", studyYears: ["1", "3"], requirements: "",
    });
  });
});
