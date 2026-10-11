// The public origin of this deployment, used to build the links in emails.
// It comes from configuration (APP_URL) — never from the request's Host header,
// which an attacker can set to make the app email a link to their own site.
//
// No Next.js imports: also used by scripts and by next.config.mjs-style code.

export function getSiteUrl(env = process.env) {
  const explicit = env.APP_URL;
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL ?? env.VERCEL_URL;
  const raw = explicit || (vercel ? `https://${vercel}` : "http://localhost:3000");
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("protocol");
    return url.origin;
  } catch {
    throw new Error("APP_URL is not a valid URL.");
  }
}

/** True when the deployment is served over HTTPS (cookies are then marked Secure). */
export function isHttpsDeployment(env = process.env) {
  return Boolean(env.VERCEL) || (env.APP_URL ?? "").startsWith("https://");
}
