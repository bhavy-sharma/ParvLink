import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/layout/logo";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { SiteFooter } from "@/components/layout/site-footer";
import { LoadingRegion, Skeleton } from "@/components/ui/misc";
import { homeForRole } from "@/lib/auth/routes";
import { getCurrentRole, requireUser } from "@/lib/auth/session";

export const metadata = { title: { default: "Your account", template: "%s · Campus Partner Finder" } };

// Account pages (delete account, feedback) are open to every signed-in person:
// students, suspended students and admins alike. That is why they sit outside
// the student area, which a suspended student cannot enter.
export default function AccountLayout({ children }) {
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<Fallback />}>
        <Frame>{children}</Frame>
      </Suspense>
      <SiteFooter signedIn />
    </div>
  );
}

async function Frame({ children }) {
  await requireUser(); // each page and action repeats this
  const home = homeForRole(await getCurrentRole());
  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo href={home} />
          <div className="flex items-center gap-3">
            <Link href={home} className="text-sm font-semibold text-brand underline">
              Back to the app
            </Link>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
        {children}
      </main>
    </>
  );
}

function Fallback() {
  return (
    <LoadingRegion label="Loading your account" className="mx-auto w-full max-w-2xl flex-1 space-y-4 px-4 pt-24 sm:px-6">
      <Skeleton className="h-10 w-56" />
      <Skeleton className="h-40" />
    </LoadingRegion>
  );
}
