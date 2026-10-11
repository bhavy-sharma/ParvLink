// Lands here from the links this app emails:
//
//   ?token=…&type=email      confirm the address, sign in, go on to the app
//   ?token=…&type=recovery   password reset: sign in on this device with a
//                            short-lived permission to choose a new password
//
// The session cookie is set here on the server, then the browser is sent on.
// Nothing from the query string is echoed back to a page, and the token is
// never logged.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { REGISTRATION_COOKIE, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/cookies";
import { logServerError } from "@/lib/auth/errors";
import { ROUTES } from "@/lib/auth/routes";
import { looksLikeToken } from "@/lib/auth/tokens";
import { confirmEmail, openPasswordReset } from "@/lib/services/auth";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  const type = searchParams.get("type");

  // redirect() sends a relative Location, so the browser stays on whichever
  // host it used and keeps the session cookie that was just set.
  let outcome = "invalid";
  try {
    if (looksLikeToken(token) && (type === "email" || type === "recovery")) {
      const cookieStore = await cookies();
      const result =
        type === "email"
          ? await confirmEmail({ token, browserNonce: cookieStore.get(REGISTRATION_COOKIE)?.value ?? null })
          : await openPasswordReset({ token });
      if (result.status === "ok") {
        cookieStore.set(SESSION_COOKIE, result.sessionToken, sessionCookieOptions());
        cookieStore.delete({ name: REGISTRATION_COOKIE, path: ROUTES.authConfirm });
        // A reset link — or a confirmation opened in a different browser from the
        // one that registered — continues at "choose a password".
        outcome = type === "recovery" || result.choosePassword ? "choose_password" : "ok";
      } else {
        outcome = result.status; // "expired" | "invalid"
      }
    }
  } catch (error) {
    logServerError("auth.confirm", error);
    outcome = "unavailable";
  }

  // redirect() throws, so it must stay outside the try/catch above.
  if (outcome === "choose_password") redirect(ROUTES.resetPassword);
  if (outcome === "ok") redirect(ROUTES.onboarding);
  redirect(`${ROUTES.authError}?reason=${outcome}`);
}
