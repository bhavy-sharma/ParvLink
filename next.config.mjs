const isDev = process.env.NODE_ENV === "development";
// HTTPS-only headers are sent when the deployment itself is served over HTTPS
// (always true on Vercel), so a local `next start` on http://localhost works.
const isHttpsDeployment = Boolean(process.env.VERCEL) || (process.env.APP_URL ?? "").startsWith("https://");

// Baseline Content-Security-Policy. The browser may only talk to this app:
// there is no third-party script, image, font or connection origin at all
// (photos and live chat updates are served by this app itself). It still allows
// inline scripts, which Next.js needs unless nonces are used — see SECURITY.md
// ("Remaining hardening") before treating this as XSS protection.
const csp = [
  "default-src 'self'",
  script-src 'self' 'unsafe-inline' https://www.googletagmanager.com${isDev ? " 'unsafe-eval'" : ""},
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data: https://.google-analytics.com https://.googletagmanager.com",
  "font-src 'self'",
  "connect-src 'self' https://.google-analytics.com https://.analytics.google.com https://*.googletagmanager.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isHttpsDeployment ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isHttpsDeployment ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  experimental: {
    serverActions: {
      // Profile photos are posted to a Server Action (max 4 MB, see
      // src/lib/validation/limits.js). Vercel caps request bodies at 4.5 MB.
      bodySizeLimit: "4500kb",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
