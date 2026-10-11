"use client";

import { usePathname } from "next/navigation";
import { ROUTES } from "@/lib/auth/routes";

/**
 * The bottom tab bar on phones. It steps aside on a chat screen, where the
 * message box sits at the bottom edge instead (the chat has its own "back").
 */
export function MobileTabBar({ children }) {
  const pathname = usePathname();
  if (pathname.startsWith(`${ROUTES.matches}/`)) return null;
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] sm:hidden">
      {children}
    </nav>
  );
}
