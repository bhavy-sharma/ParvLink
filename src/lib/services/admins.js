import "server-only";

// Colleges, admin roles and college assignments. Super Admin only, apart from
// reading one's own scope. Every change is written to the audit log by the
// same function that makes it.

import { isDuplicateKey } from "@/lib/db/connection";
import { ADMIN_PERMISSIONS, AdminCollegeAccess, College, Profile, User } from "@/lib/db/models";
import { audit, fail, isSuperAdmin, myAssignments, plain, requireAdmin, requireSuperAdmin, ServiceError } from "./core";

const collegeView = (college) => ({ id: college._id, name: college.name, slug: college.slug, city: college.city, is_active: college.is_active, created_at: college.created_at });
const auditCollege = (college) => ({ id: college._id, name: college.name, slug: college.slug, city: college.city, is_active: college.is_active });

/**
 * What the signed-in admin may act on: Super Admin → every college with every
 * permission; admin → their own assignments. Used to decide what to SHOW; each
 * service checks again for itself.
 */
export async function my_admin_scope(ctx) {
  requireAdmin(ctx);
  if (isSuperAdmin(ctx)) {
    const colleges = await College.find({}).select("name city is_active").sort({ name: 1 }).lean();
    return colleges.map((college) => ({ college: { id: college._id, name: college.name, city: college.city, is_active: college.is_active }, permissions: [...ADMIN_PERMISSIONS] }));
  }
  const assignments = await myAssignments(ctx);
  const colleges = await College.find({ _id: { $in: assignments.map((row) => row.college_id) } }).select("name city is_active").lean();
  const byId = new Map(colleges.map((college) => [college._id, college]));
  return assignments
    .filter((row) => byId.has(row.college_id))
    .map((row) => {
      const college = byId.get(row.college_id);
      return { college: { id: college._id, name: college.name, city: college.city, is_active: college.is_active }, permissions: row.permissions };
    })
    .sort((a, b) => a.college.name.localeCompare(b.college.name));
}

// ----------------------------------------------------------------------------- colleges
export async function admin_list_colleges(ctx) {
  requireSuperAdmin(ctx);
  const rows = await College.find({}).sort({ is_active: -1, name: 1 }).lean();
  return plain(rows.map(collegeView));
}

export async function admin_get_college(ctx, { college_id }) {
  requireSuperAdmin(ctx);
  const college = await College.findById(college_id).lean();
  if (!college) return null;
  return { college: plain(collegeView(college)), students: await Profile.countDocuments({ college_id: college._id }) };
}

function collegeConflict(error) {
  const field = isDuplicateKey(error, "slug") ? "slug" : "name";
  return new ServiceError("college_exists", { code: "23505", details: field });
}

function readCollege({ name, slug, city }) {
  const cleanName = String(name ?? "").trim();
  const cleanSlug = String(slug ?? "").trim();
  const cleanCity = typeof city === "string" && city.trim() !== "" ? city.trim() : null;
  if (cleanName.length < 2 || cleanName.length > 120) fail("invalid_college_details", "name");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(cleanSlug) || cleanSlug.length < 2 || cleanSlug.length > 60) fail("invalid_college_details", "slug");
  if (cleanCity && cleanCity.length > 80) fail("invalid_college_details", "city");
  return { name: cleanName, name_lower: cleanName.toLowerCase(), slug: cleanSlug, city: cleanCity };
}

export async function admin_create_college(ctx, input) {
  const uid = requireSuperAdmin(ctx);
  const fields = readCollege(input);
  let college;
  try {
    college = await College.create({ ...fields, is_active: true, created_by: uid }); // the creator is the caller, always
  } catch (error) {
    if (isDuplicateKey(error)) throw collegeConflict(error);
    throw error;
  }
  await audit(ctx, "colleges.insert", "colleges", college._id, college._id, { new: auditCollege(college) });
  return college._id;
}

/** Colleges are closed, never deleted. Returns false if the college does not exist. */
export async function admin_update_college(ctx, { college_id, is_active, ...input }) {
  requireSuperAdmin(ctx);
  const fields = readCollege(input);
  const before = await College.findById(college_id).lean();
  if (!before) return false;
  let after;
  try {
    after = await College.findOneAndUpdate({ _id: college_id }, { $set: { ...fields, is_active: Boolean(is_active) } }, { new: true }).lean();
  } catch (error) {
    if (isDuplicateKey(error)) throw collegeConflict(error);
    throw error;
  }
  await audit(ctx, "colleges.update", "colleges", college_id, college_id, { old: auditCollege(before), new: auditCollege(after) });
  return true;
}

// ----------------------------------------------------------------------------- admin roles
export async function admin_list_admins(ctx) {
  requireSuperAdmin(ctx);
  const users = await User.find({ role: { $in: ["admin", "super_admin"] } }).select("email role role_updated_at created_at").lean();
  const profiles = await Profile.find({ _id: { $in: users.map((user) => user._id) } }).select("first_name").lean();
  const names = new Map(profiles.map((profile) => [profile._id, profile.first_name]));
  return plain(
    users
      .map((user) => ({ user_id: user._id, email: user.email, first_name: names.get(user._id) ?? null, role: user.role, role_updated_at: user.role_updated_at ?? user.created_at }))
      .sort((a, b) => Number(b.role === "super_admin") - Number(a.role === "super_admin") || a.email.localeCompare(b.email)),
  );
}

/** Makes a registered, email-confirmed user an admin. Nobody can do this to themselves or to a Super Admin. */
export async function admin_grant_admin_role(ctx, { target_email }) {
  const actor = requireSuperAdmin(ctx);
  const email = String(target_email ?? "").trim().toLowerCase();
  const target = await User.findOne({ email, email_confirmed_at: { $ne: null } }).select("role").lean();
  if (!target) fail("user_not_found");
  if (target._id === actor) fail("cannot_change_own_role");
  if (target.role === "super_admin") fail("cannot_modify_super_admin");
  if (target.role === "admin") fail("already_admin");

  const changed = await User.updateOne({ _id: target._id, role: "student" }, { $set: { role: "admin", role_granted_by: actor, role_updated_at: new Date() } });
  if (changed.modifiedCount !== 1) fail("already_admin");
  await audit(ctx, "user_roles.update", "user_roles", target._id, null, { old: { role: "student" }, new: { role: "admin" } });
  return target._id;
}

/** Removes the admin role. Their college assignments go with it, so nothing stale is left behind. */
export async function admin_revoke_admin_role(ctx, { target_user_id }) {
  const actor = requireSuperAdmin(ctx);
  if (!target_user_id || target_user_id === actor) fail("cannot_change_own_role");
  const changed = await User.updateOne({ _id: target_user_id, role: "admin" }, { $set: { role: "student", role_granted_by: actor, role_updated_at: new Date() } });
  if (changed.modifiedCount !== 1) fail("target_not_admin");
  await AdminCollegeAccess.deleteMany({ admin_user_id: target_user_id });
  await audit(ctx, "user_roles.update", "user_roles", target_user_id, null, { old: { role: "admin" }, new: { role: "student" } });
}

// ----------------------------------------------------------------------------- college assignments
export async function admin_list_access(ctx) {
  requireSuperAdmin(ctx);
  const rows = await AdminCollegeAccess.find({}).lean();
  const colleges = await College.find({ _id: { $in: rows.map((row) => row.college_id) } }).select("name is_active").lean();
  const byId = new Map(colleges.map((college) => [college._id, college]));
  return rows.map((row) => ({
    admin_user_id: row.admin_user_id,
    college_id: row.college_id,
    permissions: row.permissions,
    colleges: byId.has(row.college_id) ? { name: byId.get(row.college_id).name, is_active: byId.get(row.college_id).is_active } : null,
  }));
}

function readPermissions(permissions) {
  const list = [...new Set(Array.isArray(permissions) ? permissions : [])];
  if (list.length < 1 || list.length > ADMIN_PERMISSIONS.length || list.some((p) => !ADMIN_PERMISSIONS.includes(p))) fail("invalid_permissions");
  return ADMIN_PERMISSIONS.filter((p) => list.includes(p)); // canonical order
}

/** Assigns an admin to a college, or changes the permissions of an existing assignment. → "created" | "updated" */
export async function admin_assign_college(ctx, { user_id, college_id, permissions }) {
  const actor = requireSuperAdmin(ctx);
  const list = readPermissions(permissions);
  const target = await User.findById(user_id).select("role").lean();
  if (!target) throw new ServiceError("missing_reference", { code: "23503" });
  if (target.role !== "admin") fail("target_not_admin"); // only people who hold the admin role can be assigned
  if (!(await College.exists({ _id: college_id }))) throw new ServiceError("missing_reference", { code: "23503" });

  const existing = await AdminCollegeAccess.findOne({ admin_user_id: user_id, college_id }).lean();
  if (existing) {
    await AdminCollegeAccess.updateOne({ _id: existing._id }, { $set: { permissions: list } });
    await audit(ctx, "admin_college_access.update", "admin_college_access", user_id, college_id, { old: { permissions: existing.permissions }, new: { permissions: list } });
    return "updated";
  }
  try {
    await AdminCollegeAccess.create({ admin_user_id: user_id, college_id, permissions: list, granted_by: actor });
  } catch (error) {
    if (isDuplicateKey(error)) return admin_assign_college(ctx, { user_id, college_id, permissions });
    throw error;
  }
  await audit(ctx, "admin_college_access.insert", "admin_college_access", user_id, college_id, { new: { permissions: list } });
  return "created";
}

/** Returns false if there was no such assignment. Takes effect on the admin's next request. */
export async function admin_revoke_college_access(ctx, { user_id, college_id }) {
  requireSuperAdmin(ctx);
  const removed = await AdminCollegeAccess.findOneAndDelete({ admin_user_id: user_id, college_id }).lean();
  if (!removed) return false;
  await audit(ctx, "admin_college_access.delete", "admin_college_access", user_id, college_id, { old: { permissions: removed.permissions } });
  return true;
}
