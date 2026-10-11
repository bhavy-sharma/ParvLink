// Roles, colleges, admin assignments, profiles, private data and photos.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { run, SERVICES } from "@/lib/services";
import { as, createWorld, dobForAge, errorOf, makeStudent, makeUser, models, ok, refused, tinyWebp, testDatabase } from "./helpers";

const { AdminCollegeAccess, AuditLog, College, Photo, Profile, ProfilePrivate, User } = models;
const db = testDatabase("roles");
let c;
let u;
beforeAll(async () => {
  await db.start();
  ({ c, u } = await createWorld());
});
afterAll(() => db.stop());

const roleOf = async (id) => (await User.findById(id).lean()).role;
const audits = (target) => AuditLog.find({ target_id: target }).sort({ seq: 1 }).lean();

describe("roles", () => {
  test("no service lets anyone set their own role, verification or college", async () => {
    // The only role-changing services are the two Super-Admin ones.
    const roleWriters = Object.keys(SERVICES).filter((name) => /role/.test(name));
    expect(roleWriters.sort()).toEqual(["admin_grant_admin_role", "admin_revoke_admin_role"]);
    // Extra fields in a profile edit are not a way in.
    await run(await as(u.a1), "update_my_profile", { first_name: "Arjun", course: "B.Tech", study_year: 2, bio: "", role: "super_admin", is_verified: true, status: "active", college_id: c.b });
    expect(await roleOf(u.a1)).toBe("student");
    expect(await Profile.findById(u.a1).lean()).toMatchObject({ is_verified: false, college_id: c.a });
  });

  test("a Super Admin promotes a confirmed user; it is audited with the real actor", async () => {
    const email = (await User.findById(u.newcomer).lean()).email;
    expect(await ok(u.superAdmin, "admin_grant_admin_role", { target_email: ` ${email.toUpperCase()} ` })).toBe(u.newcomer);
    expect(await roleOf(u.newcomer)).toBe("admin");
    const [entry] = (await audits(u.newcomer)).slice(-1);
    expect(entry).toMatchObject({ actor_id: u.superAdmin, action: "user_roles.update", metadata: { old: { role: "student" }, new: { role: "admin" } } });
    expect(await refused(u.superAdmin, "admin_grant_admin_role", { target_email: email })).toBe("already_admin");
  });

  test("unknown, unconfirmed, own and Super Admin targets are refused", async () => {
    const mail = async (id) => (await User.findById(id).lean()).email;
    expect(await refused(u.superAdmin, "admin_grant_admin_role", { target_email: "nobody@x.test" })).toBe("user_not_found");
    expect(await refused(u.superAdmin, "admin_grant_admin_role", { target_email: await mail(u.unverified) })).toBe("user_not_found");
    expect(await refused(u.superAdmin, "admin_grant_admin_role", { target_email: await mail(u.superAdmin) })).toBe("cannot_change_own_role");
    const other = await makeUser({ role: "super_admin" });
    expect(await refused(u.superAdmin, "admin_grant_admin_role", { target_email: await mail(other) })).toBe("cannot_modify_super_admin");
    expect(await refused(u.superAdmin, "admin_revoke_admin_role", { target_user_id: other })).toBe("target_not_admin");
    expect(await refused(u.superAdmin, "admin_revoke_admin_role", { target_user_id: u.superAdmin })).toBe("cannot_change_own_role");
    expect(await refused(u.superAdmin, "admin_revoke_admin_role", { target_user_id: u.a1 })).toBe("target_not_admin");
  });

  test("removing the admin role also removes the college assignments — nothing stale is left", async () => {
    await ok(u.superAdmin, "admin_assign_college", { user_id: u.newcomer, college_id: c.a, permissions: ["manage_events"] });
    expect(await ok(u.newcomer, "manageable_colleges")).toHaveLength(1);
    await ok(u.superAdmin, "admin_revoke_admin_role", { target_user_id: u.newcomer });
    expect(await roleOf(u.newcomer)).toBe("student");
    expect(await AdminCollegeAccess.countDocuments({ admin_user_id: u.newcomer })).toBe(0);
    expect(await refused(u.newcomer, "manageable_colleges")).toBe("not_authorized");
  });

  test("a leftover assignment grants nothing once the admin role is gone", async () => {
    const former = await makeUser();
    await AdminCollegeAccess.create({ admin_user_id: former, college_id: c.a, permissions: ["view_students", "manage_events", "moderate_reports", "manage_students"] });
    expect(await refused(former, "admin_list_users")).toBe("not_authorized");
    expect(await refused(former, "admin_overview_stats")).toBe("not_authorized");
    expect(await refused(former, "admin_create_event", { college_id: c.a })).toBe("not_authorized");
  });
});

describe("colleges", () => {
  test("a Super Admin adds, edits and closes colleges; the creator comes from the session; changes are audited", async () => {
    const id = await ok(u.superAdmin, "admin_create_college", { name: "  Gamma Institute ", slug: "gamma-institute", city: "Pune", created_by: u.a1, is_active: false });
    const stored = await College.findById(id).lean();
    expect(stored).toMatchObject({ name: "Gamma Institute", created_by: u.superAdmin, is_active: true });
    expect(await ok(u.superAdmin, "admin_update_college", { college_id: id, name: "Gamma Institute", slug: "gamma-institute", city: "", is_active: false })).toBe(true);
    expect((await College.findById(id).lean()).is_active).toBe(false);
    expect((await audits(id)).map((entry) => entry.action)).toEqual(["colleges.insert", "colleges.update"]);
    expect(await ok(u.superAdmin, "admin_update_college", { college_id: "3f2b8c1e-5a4d-4e6f-9a7b-0c1d2e3f4a5b", name: "Zeta", slug: "zeta", city: "" })).toBe(false);
  });

  test("duplicate names (any letter case) and short names are refused, and say which", async () => {
    await ok(u.superAdmin, "admin_create_college", { name: "Delta College", slug: "delta-college", city: "" });
    expect(await errorOf(u.superAdmin, "admin_create_college", { name: "DELTA college", slug: "delta-two", city: "" })).toMatchObject({ code: "23505", details: "name" });
    expect(await errorOf(u.superAdmin, "admin_create_college", { name: "Another Delta", slug: "delta-college", city: "" })).toMatchObject({ code: "23505", details: "slug" });
    expect(await refused(u.superAdmin, "admin_create_college", { name: "X", slug: "x-college", city: "" })).toBe("invalid_college_details");
    expect(await refused(u.superAdmin, "admin_create_college", { name: "Bad Slug", slug: "Bad Slug!", city: "" })).toBe("invalid_college_details");
  });

  test("there is no way to delete a college", () => {
    expect(Object.keys(SERVICES).filter((name) => /college/.test(name) && /delete|remove/.test(name))).toEqual([]);
  });

  test("students see open colleges only; a closed college's name is known only to its admins", async () => {
    const names = (await ok(u.a1, "list_active_colleges")).map((college) => college.id);
    expect(names).toContain(c.a);
    expect(names).not.toContain(c.closed);
    expect(await ok(u.a1, "college_names", { ids: [c.a, c.closed] })).toHaveLength(1);
    expect(await ok(u.superAdmin, "college_names", { ids: [c.a, c.closed] })).toHaveLength(2);
    expect(await ok(u.adminA, "college_names", { ids: [c.closed] })).toHaveLength(0);
  });
});

describe("college assignments", () => {
  test("only accounts holding the admin role can be assigned; permissions are validated", async () => {
    expect(await refused(u.superAdmin, "admin_assign_college", { user_id: u.a1, college_id: c.a, permissions: ["view_students"] })).toBe("target_not_admin");
    expect(await refused(u.superAdmin, "admin_assign_college", { user_id: u.adminNone, college_id: c.a, permissions: [] })).toBe("invalid_permissions");
    expect(await refused(u.superAdmin, "admin_assign_college", { user_id: u.adminNone, college_id: c.a, permissions: ["everything"] })).toBe("invalid_permissions");
    expect((await errorOf(u.superAdmin, "admin_assign_college", { user_id: u.adminNone, college_id: "3f2b8c1e-5a4d-4e6f-9a7b-0c1d2e3f4a5b", permissions: ["view_students"] })).code).toBe("23503");
  });

  test("assign, change permissions, revoke — each audited, and revoking takes effect on the very next call", async () => {
    expect(await ok(u.superAdmin, "admin_assign_college", { user_id: u.adminNone, college_id: c.b, permissions: ["view_students"] })).toBe("created");
    expect((await ok(u.adminNone, "admin_list_users")).length).toBeGreaterThan(0);
    expect(await ok(u.superAdmin, "admin_assign_college", { user_id: u.adminNone, college_id: c.b, permissions: ["manage_events", "view_students", "manage_events"] })).toBe("updated");
    expect((await AdminCollegeAccess.findOne({ admin_user_id: u.adminNone, college_id: c.b }).lean()).permissions).toEqual(["view_students", "manage_events"]);
    expect(await AdminCollegeAccess.findOne({ admin_user_id: u.adminNone, college_id: c.b }).lean()).toMatchObject({ granted_by: u.superAdmin });
    expect(await ok(u.superAdmin, "admin_revoke_college_access", { user_id: u.adminNone, college_id: c.b })).toBe(true);
    expect(await ok(u.adminNone, "admin_list_users")).toEqual([]);
    expect(await ok(u.superAdmin, "admin_revoke_college_access", { user_id: u.adminNone, college_id: c.b })).toBe(false);
    const actions = (await AuditLog.find({ target_table: "admin_college_access", target_id: u.adminNone }).sort({ seq: 1 }).lean()).map((entry) => entry.action);
    expect(actions).toEqual(["admin_college_access.insert", "admin_college_access.update", "admin_college_access.delete"]);
  });

  test("an admin's scope is exactly their assignments; a Super Admin's is every college with every permission", async () => {
    const mine = await ok(u.viewerA, "my_admin_scope");
    expect(mine).toEqual([{ college: expect.objectContaining({ id: c.a }), permissions: ["view_students"] }]);
    const all = await ok(u.superAdmin, "my_admin_scope");
    expect(all.length).toBe(await College.countDocuments({}));
    expect(all[0].permissions).toHaveLength(4);
  });
});

describe("creating a profile", () => {
  const form = (overrides = {}) => ({ p_first_name: " Meera ", p_college_id: c.a, p_course: "BBA", p_study_year: 3, p_date_of_birth: dobForAge(21), p_bio: "  ", ...overrides });

  test("a confirmed user creates their profile; the date of birth lands in the private collection", async () => {
    const id = await makeUser();
    expect(await ok(id, "create_my_profile", form())).toBe(id);
    expect(await Profile.findById(id).lean()).toMatchObject({ first_name: "Meera", college_id: c.a, bio: null, status: "active", is_verified: false });
    expect(Object.keys(await Profile.findById(id).lean())).not.toContain("date_of_birth");
    expect((await ProfilePrivate.findById(id).lean()).date_of_birth).toBe(form().p_date_of_birth);
    expect(await refused(id, "create_my_profile", form())).toBe("profile_exists");
  });

  test("unconfirmed email, closed or unknown college, impossible or under-age dates are all refused by the service", async () => {
    expect(await refused(u.unverified, "create_my_profile", form())).toBe("email_not_verified");
    const id = await makeUser();
    expect(await refused(id, "create_my_profile", form({ p_college_id: c.closed }))).toBe("invalid_college");
    expect(await refused(id, "create_my_profile", form({ p_college_id: "3f2b8c1e-5a4d-4e6f-9a7b-0c1d2e3f4a5b" }))).toBe("invalid_college");
    for (const dob of ["2030-01-01", "1890-01-01", "2004-02-30", "yesterday", null]) expect(await refused(id, "create_my_profile", form({ p_date_of_birth: dob }))).toBe("invalid_date_of_birth");
    expect(await refused(id, "create_my_profile", form({ p_date_of_birth: dobForAge(17) }))).toBe("under_age");
    expect(await refused(id, "create_my_profile", form({ p_first_name: "<b>x</b>" }))).toBe("invalid_profile");
    expect(await refused(id, "create_my_profile", form({ p_study_year: 9 }))).toBe("invalid_profile");
    expect(await Profile.countDocuments({ _id: id })).toBe(0);
    expect(await ProfilePrivate.countDocuments({ _id: id })).toBe(0);
  });

  test("the profile is always the caller's: there is no parameter for whose", async () => {
    const id = await makeUser();
    await run(await as(id), "create_my_profile", { ...form(), p_user_id: u.a1, user_id: u.a1, id: u.a1 });
    expect(await Profile.countDocuments({ _id: id })).toBe(1);
    expect((await Profile.findById(u.a1).lean()).first_name).toBe("Arjun");
  });
});

describe("profiles and private data", () => {
  test("a student reads and edits only their own profile", async () => {
    expect((await ok(u.a1, "my_profile")).first_name).toBe("Arjun");
    expect(await ok(u.a1, "update_my_profile", { first_name: "Arjun", course: "B.Tech Mechanical", study_year: 4, bio: "Hello" })).toBe(true);
    expect(await Profile.findById(u.a1).lean()).toMatchObject({ course: "B.Tech Mechanical", study_year: 4, bio: "Hello" });
    expect((await Profile.findById(u.a2).lean()).course).toBe("B.Tech Computer Science");
    expect(await refused(u.a1, "update_my_profile", { first_name: "", course: "B.Tech", study_year: 2, bio: "" })).toBe("invalid_profile");
    expect(await refused(u.a1, "update_my_profile", { first_name: "Arjun", course: "B.Tech", study_year: 2, bio: "x".repeat(501) })).toBe("invalid_profile");
  });

  test("a suspended student cannot edit their profile or photo", async () => {
    expect(await ok(u.suspendedA, "update_my_profile", { first_name: "Sam", course: "B.Tech", study_year: 2, bio: "" })).toBe(false);
    expect(await ok(u.suspendedA, "set_my_photo", { webp: await tinyWebp() })).toBe(false);
    expect(await ok(u.suspendedA, "remove_my_photo")).toBe(false);
  });

  test("date of birth and gender are returned to their owner only — no service takes a user id for them", async () => {
    expect(await ok(u.a1, "my_private_profile")).toEqual({ date_of_birth: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), gender: "male" });
    const source = SERVICES.my_private_profile.toString();
    expect(source.slice(0, source.indexOf(")"))).toBe("async function my_private_profile(ctx");
    // Nothing a staff member can call returns either field.
    const summary = JSON.stringify(await ok(u.superAdmin, "admin_get_user", { p_user: u.a1 }));
    const list = JSON.stringify(await ok(u.superAdmin, "admin_list_users"));
    for (const text of [summary, list]) {
      expect(text).not.toContain("date_of_birth");
      expect(text).not.toContain("gender");
      expect(text).not.toContain("@svc.test");
    }
  });
});

describe("photos", () => {
  test("a new photo replaces the old one; only real WebP data is stored", async () => {
    const id = await makeStudent(c.a, { firstName: "Photo" });
    const before = (await Profile.findById(id).lean()).avatar_path;
    expect(await ok(id, "set_my_photo", { webp: await tinyWebp() })).toBe(true);
    const after = (await Profile.findById(id).lean()).avatar_path;
    expect(after).not.toBe(before);
    expect(after).toMatch(new RegExp(`^${id}/[0-9a-f-]{36}\\.webp$`));
    expect((await Photo.find({ user_id: id }).lean()).map((photo) => photo._id)).toEqual([after]);
    for (const bad of [Buffer.from("<script>alert(1)</script>"), Buffer.alloc(0), "not a buffer", Buffer.alloc(1048577)]) {
      expect(await refused(id, "set_my_photo", { webp: bad })).toBe("invalid_photo");
    }
    expect(await ok(id, "remove_my_photo")).toBe(true);
    expect(await Photo.countDocuments({ user_id: id })).toBe(0);
    expect(await ok(id, "my_photo")).toBeNull();
  });

  test("the own-photo service returns the caller's photo and has no parameter for anyone else's", async () => {
    const mine = await ok(u.a1, "my_photo", { user_id: u.a2, avatar_path: (await Profile.findById(u.a2).lean()).avatar_path });
    expect(mine.content_type).toBe("image/webp");
    const key = (await Profile.findById(u.a1).lean()).avatar_path;
    expect(Buffer.compare(mine.data, Buffer.from((await Photo.findById(key).lean()).data.buffer))).toBe(0);
  });
});
