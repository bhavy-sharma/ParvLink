// "Am I still signed in?" — 204 if yes, 401 if not. Nothing else is revealed.
//
// The chat screen stays open for a long time and talks to the server in the
// background. If one of those calls fails, it asks here whether the session
// has ended, so it can send the student to the login page instead of showing
// a misleading "check your connection".

import { getCurrentUser } from "@/lib/auth/session";

const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  const user = await getCurrentUser().catch(() => null);
  return new Response(null, { status: user ? 204 : 401, headers });
}
