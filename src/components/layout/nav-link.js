"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";

/**
 * A navigation link that marks itself as the current page.
 * `exact` matches only the path itself (used for section roots like /admin).
 */
export function NavLink({ href, exact = false, className, activeClassName, notificationCount = 0, clearNotificationOnClick = false, children }) {
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(false);
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  const showNotification = notificationCount > 0 && !dismissed;

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(className, active && activeClassName)}
      onClick={clearNotificationOnClick ? () => setDismissed(true) : undefined}
    >
      {children}
      {showNotification ? (
        <span
          aria-label={`${notificationCount} new matches`}
          className="inline-flex items-center rounded-full bg-danger px-1.5 py-0.5 text-[10px] leading-none font-bold text-white"
        >
          +{notificationCount}
        </span>
      ) : null}
    </Link>
  );
}
