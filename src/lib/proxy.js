// Coarse route gate, run by src/proxy.js before anything renders.
//
// What this does:
//   * sends visitors WITHOUT a session cookie away from protected paths with a
//     real HTTP redirect, before any page code runs;
//   * sends visitors WITH a session cookie away from /login and /register.
//
// What this does NOT do: decide who somebody is. It only looks at whether a
// well-formed session cookie is present; it does not talk to the database.
// The authoritative check — is this token a live session, whose, with which
// role — happens in src/lib/auth/session.js on every page and Server Action,
// and the services check again. A made-up cookie therefore gets past this
// gate and no further: the guard finds no session and sends it to log in.

import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import { isGuestOnlyPath, isProtectedPath, ROUTES, safeNextPath } from "@/lib/auth/routes";
import { looksLikeToken } from "@/lib/auth/tokens";

export function gate(request) {
  const { pathname, search } = request.nextUrl;
  const hasSession = looksLikeToken(request.cookies.get(SESSION_COOKIE)?.value);

  const redirectTo = (path) => {
    // Derive the target from the incoming URL so the host never changes.
    const target = request.nextUrl.clone();
    const [pathnamePart, searchPart = ""] = path.split("?");
    target.pathname = pathnamePart;
    target.search = searchPart ? `?${searchPart}` : "";
    const redirect = NextResponse.redirect(target);
    redirect.headers.set("Cache-Control", "private, no-store");
    return redirect;
  };

  // A Server Action posted after the session ended is NOT redirected here: the
  // browser's action call cannot follow an HTTP redirect and would show an error
  // page. It is let through instead, and the action's own guard (every action
  // starts with one — tests/unit/guards.test.js checks that) answers with a
  // redirect to the login page that the client understands. With no session
  // every service refuses the request.
  const isServerAction = request.method === "POST" && request.headers.has("next-action");

  if (!hasSession && isProtectedPath(pathname) && !isServerAction) {
    const next = safeNextPath(`${pathname}${search}`, "");
    return redirectTo(next ? `${ROUTES.login}?next=${encodeURIComponent(next)}` : ROUTES.login);
  }
  if (hasSession && isGuestOnlyPath(pathname)) {
    return redirectTo(ROUTES.dashboard);
  }
  return NextResponse.next({ request });
}
