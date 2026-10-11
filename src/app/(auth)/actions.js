"use server";

// Registering, signing in and out, and the two emailed links (confirm address,
// reset password). These are the only Server Actions that work without a
// session. Each validates its input, is rate limited in the service it calls,
// and answers in a way that does not reveal whether an address has an account.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { REGISTRATION_COOKIE, registrationCookieOptions, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/cookies";
import { describeAuthError, logServerError } from "@/lib/auth/errors";
import { rememberPendingEmail } from "@/lib/auth/pending-email";
import { clientIp } from "@/lib/auth/request";
import { homeForRole, ROUTES, safeNextPath } from "@/lib/auth/routes";
import { requireUser } from "@/lib/auth/session";
import { formError, formSuccess, GENERIC_ERROR } from "@/lib/form-state";
import { destroySession, login, registerAccount, requestPasswordReset, resendVerification, setNewPassword } from "@/lib/services/auth";
import { LEGAL_VERSION } from "@/lib/validation/limits";
import { emailOnlySchema, fieldErrors, loginSchema, registerSchema, resetPasswordSchema } from "@/lib/validation/schemas";

const LIMITED = { code: "over_request_rate_limit" };

export async function registerAction(_previous, formData) {
  const email = formData.get("email");
  const parsed = registerSchema.safeParse({
    email,
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    agree: formData.get("agree"),
  });
  // Passwords are never sent back to the form.
  const values = { email: typeof email === "string" ? email.slice(0, 254) : "" };
  if (!parsed.success) {
    return formError("Check the highlighted fields.", { fieldErrors: fieldErrors(parsed.error), values });
  }

  let result;
  try {
    // No role, college or other privilege is sent with sign-up: every new
    // account is created as a student by the service itself.
    result = await registerAccount({ email: parsed.data.email, password: parsed.data.password, termsVersion: LEGAL_VERSION, ip: await clientIp() });
  } catch (error) {
    logServerError("auth.register", error);
    return formError(GENERIC_ERROR, { values });
  }
  if (result.status === "limited") return formError(describeAuthError(LIMITED), { values });
  if (result.status === "closed") return formError(describeAuthError({ code: "signup_disabled" }), { values });
  if (result.status === "invalid_password") {
    return formError("Check the highlighted fields.", { fieldErrors: { password: "That password is too long. Use a shorter one." }, values });
  }

  // Lets the confirmation link recognise this browser (see services/auth.js).
  (await cookies()).set(REGISTRATION_COOKIE, result.browserNonce, registrationCookieOptions());
  // Same destination whether or not the address was already registered, so
  // this form cannot be used to find out who has an account.
  await rememberPendingEmail(parsed.data.email);
  redirect(ROUTES.verifyEmail);
}

export async function loginAction(_previous, formData) {
  const email = formData.get("email");
  const parsed = loginSchema.safeParse({ email, password: formData.get("password") });
  const values = { email: typeof email === "string" ? email.slice(0, 254) : "" };
  if (!parsed.success) {
    return formError("Check the highlighted fields.", { fieldErrors: fieldErrors(parsed.error), values });
  }

  let result;
  try {
    result = await login({ ...parsed.data, ip: await clientIp() });
  } catch (error) {
    logServerError("auth.login", error);
    return formError(GENERIC_ERROR, { values });
  }
  if (result.status === "limited") return formError(describeAuthError(LIMITED), { values });
  if (result.status === "unverified") {
    await rememberPendingEmail(parsed.data.email);
    redirect(ROUTES.verifyEmail);
  }
  if (result.status !== "ok") {
    logServerError("auth.login", { code: "invalid_credentials" });
    return formError(describeAuthError({ code: "invalid_credentials" }), { values });
  }

  (await cookies()).set(SESSION_COOKIE, result.sessionToken, sessionCookieOptions());
  // The landing page comes from the role in the database — not from anything posted.
  redirect(safeNextPath(formData.get("next"), homeForRole(result.role)));
}

export async function logoutAction() {
  const cookieStore = await cookies();
  try {
    await destroySession(cookieStore.get(SESSION_COOKIE)?.value);
  } catch (error) {
    logServerError("auth.logout", error);
  }
  cookieStore.delete(SESSION_COOKIE);
  redirect(ROUTES.login);
}

export async function resendVerificationAction(_previous, formData) {
  const parsed = emailOnlySchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return formError("Check the email address.", { fieldErrors: fieldErrors(parsed.error) });
  }

  let outcome = "ok";
  try {
    outcome = await resendVerification({ email: parsed.data.email, ip: await clientIp() });
  } catch (error) {
    logServerError("auth.resend", error); // falls through to the same neutral answer
  }
  if (outcome === "limited") {
    return formError(describeAuthError({ code: "over_email_send_rate_limit" }), { values: { email: parsed.data.email } });
  }

  await rememberPendingEmail(parsed.data.email);
  return formSuccess("If that address has an unconfirmed account, a new link is on its way. It can take a minute to arrive.", {
    values: { email: parsed.data.email },
  });
}

// ---------------------------------------------------------------------------
// Forgotten password
// ---------------------------------------------------------------------------

/** Emails a reset link. The answer is the same whether or not the address has an account. */
export async function requestPasswordResetAction(_previous, formData) {
  const parsed = emailOnlySchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return formError("Check the email address.", { fieldErrors: fieldErrors(parsed.error) });
  }

  let outcome = "ok";
  try {
    outcome = await requestPasswordReset({ email: parsed.data.email, ip: await clientIp() });
  } catch (error) {
    logServerError("auth.recover", error); // the same neutral answer either way
  }
  if (outcome === "limited") {
    return formError(describeAuthError({ code: "over_email_send_rate_limit" }), { values: { email: parsed.data.email } });
  }
  return formSuccess("If that address has an account, a link to choose a new password is on its way. It can take a minute to arrive, and works for a limited time.");
}

/**
 * Sets a new password. Only possible for a few minutes after opening an emailed
 * link on this device: the link's session carries that permission, and it is
 * spent by the change. A normal signed-in session (for example on an unattended
 * laptop) is not enough.
 */
export async function resetPasswordAction(_previous, formData) {
  const user = await requireUser();
  const parsed = resetPasswordSchema.safeParse({ password: formData.get("password"), confirmPassword: formData.get("confirmPassword") });
  if (!parsed.success) {
    return formError("Check the highlighted fields.", { fieldErrors: fieldErrors(parsed.error) });
  }

  let outcome;
  try {
    outcome = await setNewPassword({ sessionId: user.sessionId, password: parsed.data.password });
  } catch (error) {
    logServerError("auth.reset", error);
    return formError(GENERIC_ERROR);
  }
  if (outcome === "expired") return formError("This reset link has expired or was already used. Ask for a new one.");
  if (outcome === "same_password") {
    logServerError("auth.reset", { code: "same_password" });
    return formError(describeAuthError({ code: "same_password" }));
  }
  if (outcome !== "ok") return formError("Check the highlighted fields.", { fieldErrors: { password: "That password is too long. Use a shorter one." } });
  // The permission is spent, so the page would no longer show this form: go to its confirmation instead.
  redirect(`${ROUTES.resetPassword}?done=1`);
}
