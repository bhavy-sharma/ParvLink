import "server-only";

import { headers } from "next/headers";

/**
 * The network address a request came from, for rate limiting only. On Vercel
 * (and behind most proxies) the first entry of x-forwarded-for is set by the
 * platform. It is never stored as-is: the limiter keeps a hash.
 */
export async function clientIp() {
  const list = await headers();
  const forwarded = list.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || list.get("x-real-ip") || "unknown";
}
