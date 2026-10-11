// The cookies this app sets for signing in.
//
//   cpf_session   a random session token. httpOnly: page scripts cannot read it.
//                 The database stores only its hash (see src/lib/auth/tokens.js).
//   cpf_reg       set while registering: lets the confirmation link recognise
//                 the browser that chose the password (see services/auth.js).

import { isHttpsDeployment } from "@/lib/site-url";

export const SESSION_COOKIE = "cpf_session";
export const REGISTRATION_COOKIE = "cpf_reg";
export const SESSION_DAYS = 30;

export function sessionCookieOptions(maxAgeSeconds = SESSION_DAYS * 24 * 60 * 60) {
  return { httpOnly: true, sameSite: "lax", secure: isHttpsDeployment(), path: "/", maxAge: maxAgeSeconds };
}

export function registrationCookieOptions() {
  return { httpOnly: true, sameSite: "lax", secure: isHttpsDeployment(), path: "/auth/confirm", maxAge: 24 * 60 * 60 };
}
