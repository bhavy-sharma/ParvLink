import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { StudentShell } from "@/components/layout/student-shell";
import { LoadingRegion, Skeleton } from "@/components/ui/misc";
import { getCurrentRole, getMyProfile, requireUser } from "@/lib/auth/session";
import { ROUTES } from "@/lib/auth/routes";
import { getAvatarUrl } from "@/lib/data/avatars";
import { formatDateTimeLong } from "@/lib/dates";
import { call } from "@/lib/services";
import { ROLES } from "@/lib/validation/limits";

export default function StudentLayout({ children }) {
  // Everything that depends on who is signed in renders inside this boundary,
  // so none of it is part of the public, prerendered shell.
  return (
    <Suspense fallback={<ShellFallback />}>
      <AuthenticatedShell>{children}</AuthenticatedShell>
    </Suspense>
  );
}

async function AuthenticatedShell({ children }) {
  await requireUser();
  const [role, profile] = await Promise.all([getCurrentRole(), getMyProfile()]);
  const isStaff = role === ROLES.ADMIN || role === ROLES.SUPER_ADMIN;

  // A suspended student gets one clear notice instead of the app. This is only
  // the explanation: every partner, chat and event function refuses a
  // suspended account in the database, whatever page or request is used.
  if (profile?.status === "suspended") {
    // Also where a suspension with an end date is lifted once that date has passed.
    const { data: account } = await call("my_account_status");
    if (account?.status === "active") redirect(ROUTES.dashboard);
    return (
      <StudentShell name={profile.first_name} avatarUrl={null} showNav={false} showAdminLink={isStaff}>
        <SuspendedNotice until={account?.suspended_until ?? null} />
      </StudentShell>
    );
  }

  const avatarUrl = getAvatarUrl(profile?.avatar_path);
  const { data: unreadMatchCount } = profile ? await call("my_unread_match_count") : { data: 0 };
  return (
    <StudentShell
      name={profile?.first_name ?? null}
      avatarUrl={avatarUrl}
      showNav={Boolean(profile)}
      showAdminLink={isStaff}
      matchCount={unreadMatchCount ?? 0}
    >
      {children}
    </StudentShell>
  );
}

/** What a suspended student is told: that it happened and what it means — never the moderators' reason or notes. */
function SuspendedNotice({ until }) {
  return (
    <div className="mx-auto max-w-xl pt-4 [&_a]:font-semibold [&_a]:text-brand [&_a]:underline">
      <h1 className="text-3xl font-bold">Your account is suspended</h1>
      <p className="mt-3 text-ink-muted">
        {until
          ? `An administrator has suspended your account until ${formatDateTimeLong(until)}. It will work again the next time you open the app after that.`
          : "An administrator has suspended your account. It stays suspended until an administrator restores it."}
      </p>
      <p className="mt-3 text-ink-muted">
        While it is suspended you cannot join events, appear in partner discovery, send or receive interest, or read and send messages. Nothing has been
        deleted: your profile, matches and conversations are kept.
      </p>
      <p className="mt-3 text-ink-muted">
        If you think this is a mistake, contact your college’s administrators. The <Link href={ROUTES.terms}>Terms of use</Link> explain how moderation works, and you can
        still <Link href={ROUTES.deleteAccount}>ask for your account to be deleted</Link>.
      </p>
      <div className="mt-6">
        <SignOutButton />
      </div>
    </div>
  );
}

function ShellFallback() {
  return (
    <LoadingRegion label="Loading your account" className="flex flex-1 flex-col">
      <div className="h-16 border-b border-line bg-surface" />
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 pt-10 sm:px-6">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-40" />
      </div>
    </LoadingRegion>
  );
}
