import "server-only";

// Identity and authorization for pages, Server Actions and Route Handlers.
//
// Everything that needs to know WHO is asking goes through this file:
//
//   * Identity comes from the session cookie. Its random token is looked up (by
//     hash) in the sessions collection on every request, and the user is read
//     fresh from the database — a cookie is never trusted for anything else.
//   * Role and college scope are read from the database for that user. Nothing
//     sent by the browser (form fields, headers, query strings) is ever used to
//     decide a role or a college.
//   * The services in src/lib/services re-check everything for themselves, so
//     a missing guard here cannot by itself expose another user's data.
//
// Results are memoized per request with React's cache(), so calling a guard in
// a layout, a page and a component costs one lookup.

import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import { homeForRole, ROUTES } from "@/lib/auth/routes";
import { connectDb } from "@/lib/db/connection";
import { my_admin_scope } from "@/lib/services/admins";
import { getSessionUser } from "@/lib/services/auth";
import { makeContext } from "@/lib/services/core";
import { admin_get_event, manageable_colleges } from "@/lib/services/events";
import { my_profile } from "@/lib/services/profiles";
import { ADMIN_PERMISSION_VALUES, ROLES } from "@/lib/validation/limits";
import { eventIdSchema } from "@/lib/validation/schemas";

const KNOWN_ROLES = new Set(Object.values(ROLES));

/**
 * The verified signed-in user, or null:
 *   { id, email, role, email_confirmed_at, sessionId, recovery }
 */
export const getCurrentUser = cache(async () => {
  // Session-dependent content is rendered at request time, for this request only.
  await connection();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getSessionUser(token);
});

/** The caller as the services see it. Built from the verified session only. */
export const getCallerContext = cache(async () => makeContext(await getCurrentUser()));

/** The user's role from the database. Unknown or missing → student (least privilege). */
export const getCurrentRole = cache(async () => {
  const user = await getCurrentUser();
  if (!user) return null;
  return KNOWN_ROLES.has(user.role) ? user.role : ROLES.STUDENT;
});

/** The signed-in user's own profile (or null if they have not created one). */
export const getMyProfile = cache(async () => {
  const ctx = await getCallerContext();
  if (!ctx.uid) return null;
  try {
    await connectDb();
    return await my_profile(ctx);
  } catch (error) {
    console.error("[auth] could not read profile:", error?.code ?? error?.name ?? "error");
    throw new Error("Your profile could not be loaded.");
  }
});

export function isEmailVerified(user) {
  return Boolean(user?.email_confirmed_at);
}

// ---------------------------------------------------------------------------
// Guards. Each one redirects (never returns) when the requirement is not met.
// Call them at the top of every protected page AND every Server Action —
// layouts alone do not protect the pages beneath them.
// ---------------------------------------------------------------------------

/** Signed in, with a verified email address. */
export async function requireUser() {
  const user = await getCurrentUser();
  // A cookie that no longer belongs to a session is cleared on the way to the
  // login page (a page cannot delete a cookie itself; that route can).
  if (!user) redirect((await cookies()).has(SESSION_COOKIE) ? ROUTES.authSignedOut : ROUTES.login);
  if (!isEmailVerified(user)) redirect(ROUTES.verifyEmail);
  return user;
}

/** Signed in and holding one of the given roles; others are sent to their own home. */
export async function requireRole(...allowed) {
  const user = await requireUser();
  const role = await getCurrentRole();
  if (!allowed.includes(role)) redirect(homeForRole(role));
  return { user, role };
}

export function requireSuperAdmin() {
  return requireRole(ROLES.SUPER_ADMIN);
}

export function requireAdmin() {
  return requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
}

/**
 * Signed in with a completed student profile.
 * Admins without a student profile are sent to the admin area instead.
 */
export async function requireProfile() {
  const user = await requireUser();
  const profile = await getMyProfile();
  if (!profile) {
    const role = await getCurrentRole();
    redirect(role === ROLES.STUDENT ? ROUTES.onboarding : ROUTES.admin);
  }
  return { user, profile };
}

/**
 * For Server Actions that a screen calls from script rather than from a form
 * (the chat: send and load). The same check as requireProfile(), except that a
 * caller with no session gets `null` instead of a redirect. The screen then
 * leaves through a full page load, which drops the messages it holds in memory
 * and brings the student back here after login.
 * The action MUST return at once when this is null.
 */
export async function requireProfileOrSignedOut() {
  const user = await getCurrentUser();
  if (!user) return null;
  return requireProfile();
}

// ---------------------------------------------------------------------------
// Event management scope
// ---------------------------------------------------------------------------

/**
 * Colleges whose events the signed-in user may manage, read from the database:
 *   Super Admin → every college;
 *   admin       → colleges where their assignment includes `manage_events`.
 * Students get an empty list. Nothing from the request is consulted.
 */
export const getManageableColleges = cache(async () => {
  const role = await getCurrentRole();
  if (role !== ROLES.ADMIN && role !== ROLES.SUPER_ADMIN) return [];
  await connectDb();
  return manageable_colleges(await getCallerContext());
});

/** An admin (or Super Admin), plus the colleges whose events they may manage (possibly none). */
export async function requireEventManager() {
  const { user, role } = await requireAdmin();
  const colleges = await getManageableColleges();
  return { user, role, colleges };
}

/**
 * Loads one event for an admin screen or action, or responds "not found".
 * The service returns the event only if the caller manages its host college:
 * being able to READ a published event as an invited student is not the same
 * as being allowed to manage it.
 */
export async function requireManagedEvent(eventId) {
  const { user, role, colleges } = await requireEventManager();
  const parsed = eventIdSchema.safeParse({ eventId });
  if (!parsed.success) notFound();

  await connectDb();
  const event = await admin_get_event(await getCallerContext(), { event_id: parsed.data.eventId });
  if (!event || !colleges.some((college) => college.id === event.college_id)) notFound();
  return { user, role, colleges, event };
}

// ---------------------------------------------------------------------------
// Admin scope
// ---------------------------------------------------------------------------

/**
 * What the signed-in admin may act on, read from the database:
 *   Super Admin → every college, every permission;
 *   admin       → their own assignments.
 * Used to decide which screens and controls to SHOW. It grants nothing: every
 * admin query and action is checked again by the service it calls.
 */
export const getAdminScope = cache(async () => {
  const { user, role } = await requireAdmin();
  const isSuperAdmin = role === ROLES.SUPER_ADMIN;
  await connectDb();
  const assignments = (await my_admin_scope(await getCallerContext())).map((item) => ({
    college: item.college,
    permissions: isSuperAdmin ? ADMIN_PERMISSION_VALUES : item.permissions,
  }));

  /** Colleges where the admin holds at least one of the permissions (all assigned colleges if none are named). */
  const collegesWith = (...permissions) =>
    assignments
      .filter((item) => permissions.length === 0 || item.permissions.some((permission) => permissions.includes(permission)))
      .map((item) => item.college);

  return {
    user,
    role,
    isSuperAdmin,
    assignments,
    collegesWith,
    can: (...permissions) => isSuperAdmin || collegesWith(...permissions).length > 0,
  };
});

/** Admin scope, or a redirect to the admin overview when none of the permissions is held anywhere. */
export async function requireAdminWith(...permissions) {
  const scope = await getAdminScope();
  if (!scope.can(...permissions)) redirect(ROUTES.admin);
  return scope;
}
