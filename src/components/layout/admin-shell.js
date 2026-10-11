import Link from "next/link";
import { PairMark } from "@/components/layout/logo";
import { NavLink } from "@/components/layout/nav-link";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { BuildingIcon, GridIcon, ShieldIcon, UserIcon, UsersIcon } from "@/components/ui/icons";
import { CalendarIcon, ChartIcon, ClockIcon, FlagIcon, InboxIcon, TrashIcon } from "@/components/ui/icons-extra";
import { ROUTES } from "@/lib/auth/routes";

const link =
  "flex items-center gap-3 whitespace-nowrap rounded-field px-3 py-2.5 text-sm font-semibold text-white/70 hover:bg-white/10 hover:text-white";
const linkActive = "bg-white/15 text-white";

/**
 * Admin chrome. Deliberately unlike the student side (dark rail, wider canvas)
 * so it is always obvious which area you are in.
 */
export function AdminShell({ email, roleLabel, isSuperAdmin, hasStudentProfile, sections = {}, children }) {
  // `sections` says which areas this admin's permissions cover. Hiding a link
  // is a courtesy; each page and each database function checks for itself.
  const links = [
    { href: ROUTES.admin, label: "Overview", icon: GridIcon, exact: true },
    ...(sections.reports ? [{ href: ROUTES.adminReports, label: "Reports", icon: FlagIcon }] : []),
    ...(sections.students ? [{ href: ROUTES.adminUsers, label: "Students", icon: UserIcon }] : []),
    { href: ROUTES.adminEvents, label: "Events", icon: CalendarIcon },
    ...(sections.analytics ? [{ href: ROUTES.adminAnalytics, label: "Analytics", icon: ChartIcon }] : []),
    ...(sections.activity ? [{ href: ROUTES.adminActivity, label: "Activity", icon: ClockIcon }] : []),
    ...(isSuperAdmin
      ? [
          { href: ROUTES.adminColleges, label: "Colleges", icon: BuildingIcon },
          { href: ROUTES.adminAdmins, label: "Admins", icon: UsersIcon },
          { href: ROUTES.adminDeletions, label: "Deletions", icon: TrashIcon },
          { href: ROUTES.adminFeedback, label: "Feedback", icon: InboxIcon },
        ]
      : []),
  ];

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <aside className="bg-ink text-white lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-64 lg:shrink-0 lg:flex-col">
        <div className="flex items-center justify-between gap-3 px-4 py-4 lg:px-5 lg:py-6">
          <Link href={ROUTES.admin} className="flex items-center gap-2.5 rounded-full font-display text-lg font-bold">
            <PairMark onDark />
            <span>
              Admin
              <span className="sr-only"> — Campus Partner Finder</span>
            </span>
          </Link>
          <div className="lg:hidden">
            <SignOutButton variant="ghost" className="text-white hover:bg-white/10" />
          </div>
        </div>

        <nav aria-label="Admin" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-1 lg:flex-col lg:overflow-visible lg:pb-0">
          {links.map((item) => (
            <NavLink key={item.href} href={item.href} exact={item.exact} className={link} activeClassName={linkActive}>
              <item.icon />
              {item.label}
            </NavLink>
          ))}
          {hasStudentProfile ? (
            <Link href={ROUTES.dashboard} className={`${link} lg:mt-auto`}>
              <ShieldIcon className="size-5 opacity-0 max-lg:hidden" />
              Student view
            </Link>
          ) : null}
        </nav>

        <div className="hidden border-t border-white/15 px-5 py-5 lg:block">
          <p className="text-xs font-semibold text-marigold">{roleLabel}</p>
          <p className="mt-0.5 break-all text-sm text-white/80">{email}</p>
          <div className="mt-3">
            <SignOutButton variant="ghost" className="-ml-3.5 text-white hover:bg-white/10" />
          </div>
        </div>
      </aside>

      <main id="main" className="w-full min-w-0 flex-1 px-4 pb-16 pt-8 sm:px-8 lg:pt-10">
        <div className="mx-auto max-w-5xl">
          <p className="mb-6 text-sm text-ink-muted lg:hidden">
            {roleLabel}, signed in as <span className="break-all font-semibold text-ink">{email}</span>
          </p>
          {children}
        </div>
      </main>
    </div>
  );
}
