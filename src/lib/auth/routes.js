// Route map shared by the proxy (coarse, optimistic gate) and the server-side
// guards (authoritative checks). No secrets here — safe to import anywhere.

import { ROLES } from "@/lib/validation/limits";

export const ROUTES = Object.freeze({
  home: "/",
  login: "/login",
  register: "/register",
  verifyEmail: "/verify-email",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  privacy: "/privacy",
  terms: "/terms",
  goodbye: "/goodbye",
  account: "/account",
  deleteAccount: "/account/delete",
  feedback: "/account/feedback",
  authConfirm: "/auth/confirm",
  authError: "/auth/error",
  authSignedOut: "/auth/signed-out",
  onboarding: "/onboarding",
  dashboard: "/dashboard",
  profile: "/profile",
  events: "/events",
  matches: "/matches",
  admin: "/admin",
  adminColleges: "/admin/colleges",
  adminAdmins: "/admin/admins",
  adminEvents: "/admin/events",
  adminReports: "/admin/reports",
  adminUsers: "/admin/students",
  adminAnalytics: "/admin/analytics",
  adminActivity: "/admin/activity",
  adminDeletions: "/admin/deletions",
  adminFeedback: "/admin/feedback",
});

// Anything under these prefixes requires a signed-in user.
export const PROTECTED_PREFIXES = [ROUTES.onboarding, ROUTES.dashboard, ROUTES.profile, ROUTES.events, ROUTES.matches, ROUTES.admin, ROUTES.account, ROUTES.resetPassword];

// Signed-in users are sent away from these.
export const GUEST_ONLY_PATHS = [ROUTES.login, ROUTES.register, ROUTES.forgotPassword];

function matchesPrefix(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isProtectedPath(pathname) {
  return PROTECTED_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
}

export function isGuestOnlyPath(pathname) {
  return GUEST_ONLY_PATHS.includes(pathname);
}

export function isAdminPath(pathname) {
  return matchesPrefix(pathname, ROUTES.admin);
}

/** Where a signed-in user lands by default. */
export function homeForRole(role) {
  return role === ROLES.SUPER_ADMIN || role === ROLES.ADMIN ? ROUTES.admin : ROUTES.dashboard;
}

/**
 * Returns `value` only if it is a same-site path ("/something"), otherwise the
 * fallback. Used for every `?next=` parameter so a crafted link cannot bounce
 * a user to another site after sign-in or email confirmation.
 */
export function safeNextPath(value, fallback = ROUTES.dashboard) {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  try {
    const base = "http://internal.invalid";
    const url = new URL(value, base);
    if (url.origin !== base) return fallback;
    // Never bounce back into the auth flow itself.
    if (url.pathname.startsWith("/auth/") || isGuestOnlyPath(url.pathname)) return fallback;
    return `${url.pathname}${url.search}`;
  } catch {
    return fallback;
  }
}

/** Paths of the partner-finding pages for one event. */
export const eventPaths = (slug) => ({
  event: `${ROUTES.events}/${slug}`,
  join: `${ROUTES.events}/${slug}/join`,
  partners: `${ROUTES.events}/${slug}/partners`,
  photo: (handle) => `${ROUTES.events}/${slug}/partners/photo/${handle}`,
});

/** The chat screen of one conversation (a conversation is a match; the id is matches.public_id). */
export const chatPath = (conversation) => `${ROUTES.matches}/${conversation}`;
