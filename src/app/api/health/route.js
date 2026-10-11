// Liveness check for uptime monitors and deployment checks.
//
// Says only whether this app is running and has its configuration. It makes no
// call to MongoDB or the mail server (so it cannot be used to generate load
// there), needs no session, and reveals nothing: no versions, no settings, no
// errors. "Is the database reachable?" is covered by the smoke test in
// docs/LAUNCH.md.

import { connection } from "next/server";
import { readMongoUri } from "@/lib/db/connection";
import { readMailConfig } from "@/lib/mail/mailer";
import { getSiteUrl } from "@/lib/site-url";

const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8", "X-Robots-Tag": "noindex" };

export async function GET() {
  await connection(); // answered at request time: the settings are read from the running server, not baked in at build
  let configured = true;
  try {
    readMongoUri();
    readMailConfig();
    getSiteUrl();
    // Emailed links are built from APP_URL; a production server without it would send links to localhost.
    if (process.env.NODE_ENV === "production" && !process.env.APP_URL && !process.env.VERCEL_PROJECT_PRODUCTION_URL && !process.env.VERCEL_URL) throw new Error("APP_URL");
  } catch {
    configured = false;
  }
  return new Response(JSON.stringify({ status: configured ? "ok" : "misconfigured" }), { status: configured ? 200 : 503, headers });
}
