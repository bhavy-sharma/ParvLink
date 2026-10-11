import Link from "next/link";
import { Suspense } from "react";
import { AuthCard } from "@/components/forms/auth-card";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { homeForRole, ROUTES } from "@/lib/auth/routes";
import { getCurrentRole, requireUser } from "@/lib/auth/session";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata = { title: "Choose a new password" };

export default function ResetPasswordPage({ searchParams }) {
  return (
    <AuthCard title="Choose a new password" description="This replaces your old password everywhere.">
      <Suspense fallback={<Skeleton className="h-40" />}>
        <ResetPassword searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}

async function ResetPassword({ searchParams }) {
  const user = await requireUser();
  const params = await searchParams;
  // True for a few minutes after an emailed link was opened on this device; the action checks it again.
  const fromLink = user.recovery;
  const home = homeForRole(await getCurrentRole());

  // Shown after the action changed the password. It is only a message: the
  // flag in the address changes nothing and proves nothing.
  if (!fromLink && params.done === "1") {
    return (
      <div className="space-y-4">
        <Alert tone="success">Your password has been changed.</Alert>
        <p className="text-sm text-ink-muted">You are logged in on this device. Any other device that was logged in has been logged out.</p>
        <ButtonLink href={home}>Continue</ButtonLink>
      </div>
    );
  }

  if (!fromLink) {
    return (
      <div className="space-y-4">
        <Alert tone="warning" title="Open the link from your email first">
          A password can only be changed for a few minutes after opening a reset link. To get a new link, log out and choose “Forgot your password?” on the
          login page.
        </Alert>
        <div className="flex flex-wrap items-center gap-3">
          <SignOutButton />
          <Link href={home} className="text-sm font-semibold text-brand underline">
            Back to the app
          </Link>
        </div>
      </div>
    );
  }
  return <ResetPasswordForm />;
}
