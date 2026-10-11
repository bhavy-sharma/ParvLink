import { Logo, PairMark } from "@/components/layout/logo";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { NavLink } from "@/components/layout/nav-link";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { StudentFooter } from "@/components/layout/student-footer";
import { Avatar } from "@/components/ui/avatar";
import { HomeIcon, ShieldIcon, UserIcon, UsersIcon } from "@/components/ui/icons";
import { CalendarIcon } from "@/components/ui/icons-extra";
import { ROUTES } from "@/lib/auth/routes";

const topLink = "rounded-full px-3.5 py-2 text-sm font-semibold text-ink-muted hover:text-ink";
const topLinkActive = "bg-brand-soft text-brand-strong hover:text-brand-strong";
const tabLink = "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-semibold text-ink-muted";
const tabLinkActive = "text-brand";

/**
 * Student-facing chrome: a top bar on every screen, plus a bottom tab bar on
 * phones. `links` is empty until the student has created a profile.
 */
export function StudentShell({ name, avatarUrl, showNav, showAdminLink, matchCount = 0, children }) {
  const links = [
    ...(showNav
      ? [
          { href: ROUTES.dashboard, label: "Dashboard", icon: HomeIcon },
          { href: ROUTES.events, label: "Events", icon: CalendarIcon },
          { href: ROUTES.matches, label: "Matches", icon: UsersIcon },
          { href: ROUTES.profile, label: "Profile", icon: UserIcon },
        ]
      : []),
    ...(showAdminLink ? [{ href: ROUTES.admin, label: "Admin", icon: ShieldIcon }] : []),
  ];

  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center gap-4 px-4 sm:px-6">
          <Logo href={showNav ? ROUTES.dashboard : ROUTES.onboarding} className="max-sm:hidden" />
          <a href={showNav ? ROUTES.dashboard : ROUTES.onboarding} className="sm:hidden" aria-label="ParvLink">
            <PairMark />
          </a>

          {links.length > 0 ? (
            <nav aria-label="Main" className="hidden flex-1 items-center gap-1 sm:flex">
              {links.map((link) => (
                <NavLink
                  key={link.href === ROUTES.matches ? `${link.href}:${matchCount}` : link.href}
                  href={link.href}
                  className={topLink}
                  activeClassName={topLinkActive}
                  notificationCount={link.href === ROUTES.matches ? matchCount : 0}
                  clearNotificationOnClick={link.href === ROUTES.matches}
                >
                  {link.label}
                </NavLink>
              ))}
            </nav>
          ) : (
            <span className="flex-1" />
          )}

          <div className="ml-auto flex items-center gap-3">
            {name ? (
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Avatar src={avatarUrl} name={name} size="sm" />
                <span className="max-w-32 truncate max-sm:hidden">{name}</span>
              </span>
            ) : null}
            <SignOutButton />
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-8 sm:px-6 sm:pb-16 sm:pt-10">
        {children}
        {/* Inside <main>, above its bottom padding, so the fixed tab bar on phones never covers the links. */}
        <StudentFooter />
      </main>

      {links.length > 0 ? (
        <MobileTabBar>
          {links.map((link) => (
            <NavLink
              key={link.href === ROUTES.matches ? `${link.href}:${matchCount}` : link.href}
              href={link.href}
              className={tabLink}
              activeClassName={tabLinkActive}
              notificationCount={link.href === ROUTES.matches ? matchCount : 0}
              clearNotificationOnClick={link.href === ROUTES.matches}
            >
              <link.icon className="size-6" />
              {link.label}
            </NavLink>
          ))}
        </MobileTabBar>
      ) : null}
    </div>
  );
}
