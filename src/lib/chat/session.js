import { ROUTES } from "@/lib/auth/routes";

let leaving = false;

/**
 * After a background call failed: if the session has ended, go to the login
 * page (and come back here afterwards). Returns true if it is navigating away.
 */
export async function leaveIfSignedOut() {
  try {
    const response = await fetch("/auth/session", { cache: "no-store", credentials: "same-origin" });
    if (response.status !== 401) return false;
  } catch {
    return false; // offline: not a sign-out
  }
  // Another call already took us there: one navigation is enough.
  if (leaving || window.location.pathname === ROUTES.login) return true;
  leaving = true;
  // A full page load on purpose: it drops everything this screen holds in memory (the messages).
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`${ROUTES.login}?next=${encodeURIComponent(window.location.pathname)}`);
  return true;
}
