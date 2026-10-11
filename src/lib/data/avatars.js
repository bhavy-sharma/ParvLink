import "server-only";

import { ROUTES } from "@/lib/auth/routes";

/**
 * Address of the signed-in student's OWN photo, or null. The route behind it
 * serves the photo of whoever is signed in — it takes no user id — and the
 * query string only makes the browser fetch again after the photo changes.
 */
export function getAvatarUrl(avatarPath) {
  if (!avatarPath) return null;
  const version = avatarPath.split("/").pop().replace(/\.webp$/, "").slice(0, 12);
  return `${ROUTES.profile}/photo?v=${version}`;
}
