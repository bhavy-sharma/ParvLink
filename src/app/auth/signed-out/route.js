// Where a guard sends a browser whose session cookie no longer belongs to a
// session (expired, signed out elsewhere, account deleted). A page cannot
// delete a cookie; this route can. It then goes to the login page.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import { ROUTES } from "@/lib/auth/routes";
import { getCurrentUser } from "@/lib/auth/session";

export async function GET() {
  // Only clears a cookie that is really dead: a live session is left alone.
  if (await getCurrentUser()) redirect(ROUTES.dashboard);
  (await cookies()).delete(SESSION_COOKIE);
  redirect(ROUTES.login);
}
