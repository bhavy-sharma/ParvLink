import { Suspense } from "react";
import { AdminShell } from "@/components/layout/admin-shell";
import { LoadingRegion, Skeleton } from "@/components/ui/misc";
import { getAdminScope, getMyProfile } from "@/lib/auth/session";

export const metadata = { title: { default: "Admin", template: "%s · Admin · ParvLink" } };

export default function AdminLayout({ children }) {
  // The whole admin chrome renders behind the role check — none of it is in
  // the public, prerendered shell. Each page below repeats its own check.
  return (
    <Suspense fallback={<ShellFallback />}>
      <AuthorizedShell>{children}</AuthorizedShell>
    </Suspense>
  );
}

async function AuthorizedShell({ children }) {
  const scope = await getAdminScope(); // redirects anyone who is not an admin
  const { user, isSuperAdmin } = scope;
  const profile = await getMyProfile();

  return (
    <AdminShell
      email={user.email}
      roleLabel={isSuperAdmin ? "Super Admin" : "College admin"}
      isSuperAdmin={isSuperAdmin}
      hasStudentProfile={Boolean(profile)}
      sections={{
        reports: scope.can("moderate_reports"),
        students: scope.can("view_students", "manage_students"),
        analytics: isSuperAdmin || scope.assignments.length > 0,
        activity: scope.can("manage_events", "moderate_reports", "manage_students"),
      }}
    >
      {children}
    </AdminShell>
  );
}

function ShellFallback() {
  return (
    <LoadingRegion label="Checking your access" className="mx-auto w-full max-w-5xl space-y-4 px-4 pt-10 sm:px-8">
      <Skeleton className="h-10 w-56" />
      <Skeleton className="h-40" />
    </LoadingRegion>
  );
}
