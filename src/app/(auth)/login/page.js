import Link from "next/link";
import { Suspense } from "react";
import { AuthCard } from "@/components/forms/auth-card";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/misc";
import { ROUTES, safeNextPath } from "@/lib/auth/routes";
import { LoginForm } from "./login-form";

export const metadata = { title: "Log in" };

export default function LoginPage({ searchParams }) {
  return (
    <AuthCard
      title="Log in"
      description="Use the email and password you registered with."
      footer={
        <>
          New here? <Link href={ROUTES.register}>Create an account</Link>
        </>
      }
    >
      <Suspense fallback={<FormSkeleton />}>
        <LoginFormFromUrl searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}

async function LoginFormFromUrl({ searchParams }) {
  const params = await searchParams;
  const next = safeNextPath(params.next, "");
  return (
    <>
      {params.confirmed === "1" ? (
        <Alert tone="success" className="mb-4">
          Your email is confirmed. Log in to continue.
        </Alert>
      ) : null}
      {next ? (
        <Alert tone="info" className="mb-4">
          Log in to open that page.
        </Alert>
      ) : null}
      <LoginForm next={next} />
    </>
  );
}

function FormSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
      <Skeleton className="h-11 rounded-full" />
    </div>
  );
}
