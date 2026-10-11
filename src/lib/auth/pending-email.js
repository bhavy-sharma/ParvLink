import "server-only";

// Remembers which address we just emailed, so /verify-email can show it and
// offer "send again" without putting the address in a URL. httpOnly: page
// scripts cannot read it. Scoped to the one page that needs it.

import { cookies } from "next/headers";
import { ROUTES } from "@/lib/auth/routes";
import { emailOnlySchema } from "@/lib/validation/schemas";

const PENDING_EMAIL_COOKIE = "cpf_pending_email";

export async function rememberPendingEmail(email) {
  const cookieStore = await cookies();
  cookieStore.set(PENDING_EMAIL_COOKIE, email, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: ROUTES.verifyEmail,
    maxAge: 60 * 60,
  });
}

export async function readPendingEmail() {
  const cookieStore = await cookies();
  const parsed = emailOnlySchema.safeParse({ email: cookieStore.get(PENDING_EMAIL_COOKIE)?.value });
  return parsed.success ? parsed.data.email : null;
}
