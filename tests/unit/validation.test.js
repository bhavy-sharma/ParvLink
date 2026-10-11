import { describe, expect, test } from "vitest";
import { ageOn, latestDobForAge, parseIsoDate } from "@/lib/dates";
import { MIN_AGE } from "@/lib/validation/limits";
import {
  assignCollegeSchema,
  collegeSchema,
  fieldErrors,
  loginSchema,
  profileCreateSchema,
  profileUpdateSchema,
  registerSchema,
  slugify,
} from "@/lib/validation/schemas";

const UUID = "3f2b8c1e-5a4d-4e6f-9a7b-0c1d2e3f4a5b";
const errorsOf = (schema, input) => {
  const result = schema.safeParse(input);
  return result.success ? {} : fieldErrors(result.error);
};

describe("dates", () => {
  const now = new Date("2026-10-09T12:00:00Z");

  test("parseIsoDate accepts only real calendar dates", () => {
    expect(parseIsoDate("2004-02-29")).toEqual({ year: 2004, month: 2, day: 29 });
    for (const bad of ["2005-02-29", "2004-13-01", "04-02-2004", "2004-2-9", "", null, 20040229]) {
      expect(parseIsoDate(bad), String(bad)).toBeNull();
    }
  });

  test("ageOn counts whole years", () => {
    expect(ageOn("2008-10-09", now)).toBe(18);
    expect(ageOn("2008-10-10", now)).toBe(17);
    expect(ageOn("2000-01-01", now)).toBe(26);
    expect(ageOn("nonsense", now)).toBeNull();
  });

  test("latestDobForAge is the boundary birthday", () => {
    expect(latestDobForAge(18, now)).toBe("2008-10-09");
    expect(ageOn(latestDobForAge(MIN_AGE, now), now)).toBe(MIN_AGE);
  });
});

describe("register and login", () => {
  const valid = { email: " Student@College.EDU ", password: "correct-horse-9", confirmPassword: "correct-horse-9", agree: "on" };

  test("normalises the email", () => {
    expect(registerSchema.parse(valid).email).toBe("student@college.edu");
  });

  test("rejects weak or mismatched passwords and bad emails", () => {
    expect(errorsOf(registerSchema, { ...valid, password: "short1", confirmPassword: "short1" }).password).toMatch(/at least/);
    expect(errorsOf(registerSchema, { ...valid, password: "onlyletterslong", confirmPassword: "onlyletterslong" }).password).toMatch(/letter and one number/);
    expect(errorsOf(registerSchema, { ...valid, confirmPassword: "different-horse-9" }).confirmPassword).toMatch(/do not match/);
    expect(errorsOf(registerSchema, { ...valid, password: "a1".repeat(40), confirmPassword: "a1".repeat(40) }).password).toMatch(/at most/);
    expect(errorsOf(registerSchema, { ...valid, email: "not-an-email" }).email).toBeTruthy();
    expect(errorsOf(registerSchema, { ...valid, email: null }).email).toBeTruthy();
  });

  test("an account cannot be created without ticking the agreement", () => {
    for (const agree of [undefined, "", "off", "true", true]) {
      expect(errorsOf(registerSchema, { ...valid, agree }).agree, String(agree)).toMatch(/Tick the box to agree/);
    }
  });

  test("extra fields such as role are discarded, not passed on", () => {
    const parsed = registerSchema.parse({ ...valid, role: "super_admin", college_id: UUID, is_verified: true });
    expect(Object.keys(parsed).sort()).toEqual(["agree", "confirmPassword", "email", "password"]);
    expect(Object.keys(loginSchema.parse({ email: "a@b.co", password: "x", role: "admin" })).sort()).toEqual(["email", "password"]);
  });
});

describe("profile", () => {
  const valid = {
    firstName: "  Asha  ",
    collegeId: UUID,
    course: "B.Tech   Computer Science",
    studyYear: "2",
    dateOfBirth: latestDobForAge(20),
    bio: "",
  };

  test("accepts and tidies a valid profile", () => {
    expect(profileCreateSchema.parse(valid)).toEqual({
      firstName: "Asha",
      collegeId: UUID,
      course: "B.Tech Computer Science",
      studyYear: 2,
      dateOfBirth: valid.dateOfBirth,
      bio: null,
    });
  });

  test("accepts names in other scripts", () => {
    for (const firstName of ["आशा", "José", "Anne-Marie", "O’Brien", "மீரா"]) {
      expect(errorsOf(profileCreateSchema, { ...valid, firstName }).firstName, firstName).toBeUndefined();
    }
  });

  test("rejects markup, digits and over-long values", () => {
    expect(errorsOf(profileCreateSchema, { ...valid, firstName: "<img src=x>" }).firstName).toBeTruthy();
    expect(errorsOf(profileCreateSchema, { ...valid, firstName: "R2D2" }).firstName).toBeTruthy();
    expect(errorsOf(profileCreateSchema, { ...valid, firstName: "x".repeat(51) }).firstName).toBeTruthy();
    expect(errorsOf(profileCreateSchema, { ...valid, course: "<b>CS</b>" }).course).toBeTruthy();
    expect(errorsOf(profileCreateSchema, { ...valid, bio: "x".repeat(501) }).bio).toBeTruthy();
    expect(errorsOf(profileCreateSchema, { ...valid, studyYear: "9" }).studyYear).toBeTruthy();
    expect(errorsOf(profileCreateSchema, { ...valid, studyYear: "second" }).studyYear).toBeTruthy();
    expect(errorsOf(profileCreateSchema, { ...valid, collegeId: "1 or 1=1" }).collegeId).toBeTruthy();
  });

  test(`rejects under-${MIN_AGE}s and impossible dates`, () => {
    expect(errorsOf(profileCreateSchema, { ...valid, dateOfBirth: latestDobForAge(MIN_AGE - 1) }).dateOfBirth).toMatch(/or older/);
    expect(errorsOf(profileCreateSchema, { ...valid, dateOfBirth: latestDobForAge(MIN_AGE) }).dateOfBirth).toBeUndefined();
    expect(errorsOf(profileCreateSchema, { ...valid, dateOfBirth: "2005-02-30" }).dateOfBirth).toMatch(/real date/);
    expect(errorsOf(profileCreateSchema, { ...valid, dateOfBirth: "1850-01-01" }).dateOfBirth).toBeTruthy();
    expect(errorsOf(profileCreateSchema, { ...valid, dateOfBirth: "2999-01-01" }).dateOfBirth).toBeTruthy();
  });

  test("the edit form cannot carry protected fields", () => {
    const parsed = profileUpdateSchema.parse({ ...valid, isVerified: true, is_verified: true, status: "active", college_id: UUID, id: UUID });
    expect(Object.keys(parsed).sort()).toEqual(["bio", "course", "firstName", "studyYear"]);
  });
});

describe("colleges and admin assignments", () => {
  test("slugify", () => {
    expect(slugify("St. Xavier’s College, Mumbai")).toBe("st-xaviers-college-mumbai");
    expect(slugify("  École   Polytechnique ")).toBe("ecole-polytechnique");
    expect(slugify("x".repeat(80)).length).toBeLessThanOrEqual(60);
  });

  test("college form", () => {
    expect(collegeSchema.parse({ name: " IIT  Bombay ", slug: "IIT-Bombay", city: "", isActive: true })).toEqual({
      name: "IIT Bombay",
      slug: "iit-bombay",
      city: null,
      isActive: true,
    });
    expect(errorsOf(collegeSchema, { name: "A", slug: "ok", city: "", isActive: true }).name).toBeTruthy();
    expect(errorsOf(collegeSchema, { name: "Fine Name", slug: "not ok!", city: "", isActive: true }).slug).toBeTruthy();
    expect(errorsOf(collegeSchema, { name: "Fine Name", slug: "-bad-", city: "", isActive: true }).slug).toBeTruthy();
  });

  test("permissions must come from the fixed list", () => {
    const base = { userId: UUID, collegeId: UUID };
    expect(assignCollegeSchema.parse({ ...base, permissions: ["view_students", "view_students", "manage_events"] }).permissions).toEqual([
      "view_students",
      "manage_events",
    ]);
    expect(errorsOf(assignCollegeSchema, { ...base, permissions: [] }).permissions).toBeTruthy();
    expect(errorsOf(assignCollegeSchema, { ...base, permissions: ["super_admin"] }).permissions).toBeTruthy();
    expect(errorsOf(assignCollegeSchema, { ...base, userId: "me", permissions: ["view_students"] }).userId).toBeTruthy();
  });
});

describe("date display", () => {
  test("a date of birth is never shifted by a time zone", async () => {
    const { formatDate } = await import("@/lib/dates");
    expect(formatDate("2005-03-04")).toBe("4 Mar 2005");
    expect(formatDate("2005-01-01")).toBe("1 Jan 2005");
  });

  test("timestamps use the app's display zone (Asia/Kolkata by default)", async () => {
    const { formatDate, formatDateTime } = await import("@/lib/dates");
    expect(formatDate("2026-10-09T19:10:00Z")).toBe("10 Oct 2026");
    expect(formatDateTime("2026-10-09T19:10:00Z")).toMatch(/^10 Oct, 12:40\s?am$/i);
    expect(formatDate(null)).toBe("");
    expect(formatDate("garbage")).toBe("");
  });
});
