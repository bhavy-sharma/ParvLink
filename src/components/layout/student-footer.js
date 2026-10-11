"use client";

import { usePathname } from "next/navigation";
import { SiteFooter } from "@/components/layout/site-footer";
import { ROUTES } from "@/lib/auth/routes";

/**
 * The footer links at the end of every student page. Like the tab bar, it
 * steps aside on a chat screen, which fills the whole height of the window.
 */
export function StudentFooter() {
  const pathname = usePathname();
  if (pathname.startsWith(`${ROUTES.matches}/`)) return null;
  return <SiteFooter signedIn className="mt-12 border-t border-line px-0 pb-0" />;
}
