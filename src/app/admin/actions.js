"use server";

// Every action here:
//   1. re-checks the caller's role on the server (requireSuperAdmin) — the fact
//      that a form was rendered on an admin page proves nothing;
//   2. validates its input;
//   3. runs the change AS THE CALLER, so the database's own policies and
//      functions enforce the same rule again and write the audit entry.

import { revalidatePath } from "next/cache";
import { describeDbError, logServerError } from "@/lib/auth/errors";
import { ROUTES } from "@/lib/auth/routes";
import { requireSuperAdmin } from "@/lib/auth/session";
import { formError, formSuccess } from "@/lib/form-state";
import { call } from "@/lib/services";
import {
  adminUserSchema,
  assignCollegeSchema,
  collegeIdSchema,
  collegeSchema,
  fieldErrors,
  grantAdminSchema,
  revokeCollegeSchema,
  slugify,
} from "@/lib/validation/schemas";

const text = (formData, name) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

function collegeConflict(error, values) {
  // 23505 = unique violation; the constraint name says which field clashed.
  const onSlug = String(error.message ?? "").includes("colleges_slug_key") || String(error.details ?? "").includes("(slug)");
  return formError("Check the highlighted fields.", {
    fieldErrors: onSlug ? { slug: "Another college already uses that short name." } : { name: "A college with that name already exists." },
    values,
  });
}

function readCollegeForm(formData, { isActive }) {
  const name = text(formData, "name");
  const values = { name, slug: text(formData, "slug"), city: text(formData, "city"), isActive };
  // Blank short name → derive it from the name.
  const parsed = collegeSchema.safeParse({ ...values, slug: values.slug.trim() === "" ? slugify(name) : values.slug });
  return { values, parsed };
}

export async function createCollegeAction(_previous, formData) {
  await requireSuperAdmin();

  const { values, parsed } = readCollegeForm(formData, { isActive: true });
  if (!parsed.success) {
    return formError("Check the highlighted fields.", { fieldErrors: fieldErrors(parsed.error), values });
  }

  const { error } = await call("admin_create_college", { name: parsed.data.name, slug: parsed.data.slug, city: parsed.data.city });

  if (error) {
    if (error.code === "23505") return collegeConflict(error, values);
    logServerError("admin.college.create", error);
    return formError(describeDbError(error), { values });
  }

  revalidatePath("/", "layout");
  return formSuccess(`${parsed.data.name} was added. Students can now choose it.`);
}

export async function updateCollegeAction(_previous, formData) {
  await requireSuperAdmin();

  const id = collegeIdSchema.safeParse({ collegeId: text(formData, "collegeId") });
  const { values, parsed } = readCollegeForm(formData, { isActive: formData.get("isActive") === "on" });
  if (!id.success) return formError("That college could not be found.", { values });
  if (!parsed.success) {
    return formError("Check the highlighted fields.", { fieldErrors: fieldErrors(parsed.error), values });
  }

  const { data: found, error } = await call("admin_update_college", {
    college_id: id.data.collegeId,
    name: parsed.data.name,
    slug: parsed.data.slug,
    city: parsed.data.city,
    is_active: parsed.data.isActive,
  });

  if (error) {
    if (error.code === "23505") return collegeConflict(error, values);
    logServerError("admin.college.update", error);
    return formError(describeDbError(error), { values });
  }
  if (!found) return formError("That college could not be found.", { values });

  revalidatePath("/", "layout");
  return formSuccess("College saved.", { values: { ...values, slug: parsed.data.slug } });
}

export async function grantAdminAction(_previous, formData) {
  await requireSuperAdmin();

  const values = { email: text(formData, "email").slice(0, 254) };
  const parsed = grantAdminSchema.safeParse(values);
  if (!parsed.success) {
    return formError("Check the email address.", { fieldErrors: fieldErrors(parsed.error), values });
  }

  const { error } = await call("admin_grant_admin_role", { target_email: parsed.data.email });
  if (error) {
    logServerError("admin.role.grant", error);
    return formError(describeDbError(error), { values });
  }

  revalidatePath(ROUTES.admin, "layout");
  return formSuccess(`${parsed.data.email} is now an admin. Assign them a college below — until then they can see nothing.`);
}

export async function revokeAdminAction(_previous, formData) {
  await requireSuperAdmin();

  const parsed = adminUserSchema.safeParse({ userId: text(formData, "userId") });
  if (!parsed.success) return formError("That admin could not be found.");

  const { error } = await call("admin_revoke_admin_role", { target_user_id: parsed.data.userId });
  if (error) {
    logServerError("admin.role.revoke", error);
    return formError(describeDbError(error));
  }

  revalidatePath(ROUTES.admin, "layout");
  return formSuccess("Admin role removed.");
}

export async function assignCollegeAction(_previous, formData) {
  await requireSuperAdmin();

  const parsed = assignCollegeSchema.safeParse({
    userId: text(formData, "userId"),
    collegeId: text(formData, "collegeId"),
    permissions: formData.getAll("permissions").filter((value) => typeof value === "string"),
  });
  if (!parsed.success) {
    return formError("Check the highlighted fields.", { fieldErrors: fieldErrors(parsed.error) });
  }
  const { userId, collegeId, permissions } = parsed.data;

  const { data: outcome, error } = await call("admin_assign_college", { user_id: userId, college_id: collegeId, permissions });
  if (error) {
    logServerError("admin.access.assign", error);
    return formError(describeDbError(error, { 23503: "That admin or college no longer exists. Reload the page." }));
  }

  revalidatePath(ROUTES.admin, "layout");
  return formSuccess(outcome === "updated" ? "Permissions updated." : "College assigned.");
}

export async function revokeCollegeAccessAction(_previous, formData) {
  await requireSuperAdmin();

  const parsed = revokeCollegeSchema.safeParse({ userId: text(formData, "userId"), collegeId: text(formData, "collegeId") });
  if (!parsed.success) return formError("That assignment could not be found.");

  const { data: removed, error } = await call("admin_revoke_college_access", { user_id: parsed.data.userId, college_id: parsed.data.collegeId });

  if (error) {
    logServerError("admin.access.revoke", error);
    return formError(describeDbError(error));
  }
  if (!removed) return formError("That assignment was already removed.");

  revalidatePath(ROUTES.admin, "layout");
  return formSuccess("Access revoked.");
}
