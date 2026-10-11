import Link from "next/link";
import { Suspense } from "react";
import { AuthCard } from "@/components/forms/auth-card";
import { Skeleton } from "@/components/ui/misc";
import { readPendingEmail } from "@/lib/auth/pending-email";
import { ROUTES } from "@/lib/auth/routes";
import { ResendForm } from "./resend-form";

export const metadata = { title: "Confirm your email" };

export default function VerifyEmailPage() {
  return (
    <AuthCard
      title="Confirm your email"
      footer={
        <>
          Already confirmed? <Link href={ROUTES.login}>Log in</Link>
        </>
      }
    >
      <Suspense fallback={<Skeleton className="h-40" />}>
        <VerifyEmailBody />
      </Suspense>
    </AuthCard>
  );
}

async function VerifyEmailBody() {
  const email = await readPendingEmail();
  return (
    <div className="space-y-5">
      <p>
        {email ? (
          <>
            We sent a confirmation link to <strong className="break-all">{email}</strong>.
          </>
        ) : (
          <>We sent a confirmation link to your email address.</>
        )}{" "}
        Open it on this device to finish creating your account.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
        <li>The link works once and expires after a while.</li>
        <li>Nothing after a few minutes? Check spam, then send it again below.</li>
      </ul>
      <ResendForm email={email} />
    </div>
  );
}
