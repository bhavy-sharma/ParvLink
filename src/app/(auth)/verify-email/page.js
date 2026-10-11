import Link from "next/link";
import { Suspense } from "react";
import { AuthCard } from "@/components/forms/auth-card";
import { Skeleton } from "@/components/ui/misc";
import { readPendingEmail } from "@/lib/auth/pending-email";
import { ROUTES } from "@/lib/auth/routes";
import { ResendForm } from "./resend-form";
import { verifyEmailAction } from "../actions";

export const metadata = { title: "Confirm your email" };

// ✅ "force-dynamic" hata diya gaya hai kyunki ye cacheComponents ke saath incompatible hai.
// Next.js khud hi is page ko dynamic maan lega kyunki hum "searchParams" ko await kar rahe hain.

export default async function VerifyEmailPage({ searchParams }) {
  // Next.js 15 compatible: searchParams ek Promise hai, isliye await karna zaroori hai
  const params = await searchParams;
  const token = params?.token;

  // ✅ Agar URL me token hai, toh verification handle karo
  if (token) {
    return (
      <AuthCard
        title="Email Verification"
        footer={
          <>
            Already verified? <Link href={ROUTES.login}>Log in</Link>
          </>
        }
      >
        <Suspense fallback={<Skeleton className="h-40" />}>
          <VerifyTokenBody token={token} />
        </Suspense>
      </AuthCard>
    );
  }

  // ✅ Agar token nahi hai, toh normal "check your email" message dikhao
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

// ✅ Naya component jo actual token verify karta hai
async function VerifyTokenBody({ token }) {
  const result = await verifyEmailAction(token);

  if (result.status === "success") {
    return (
      <div className="space-y-5 text-center">
        <div className="text-5xl">🎉</div>
        <p className="text-lg font-semibold text-green-600">
          Email Successfully Verified!
        </p>
        <p className="text-sm text-ink-muted">
          {result.message} You can now log in to your account.
        </p>
        <Link 
          href={ROUTES.login} 
          className="inline-block w-full rounded-md bg-brand px-4 py-2 text-center text-sm font-semibold text-white hover:bg-brand/90 transition"
        >
          Log in now
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5 text-center">
      <div className="text-5xl">😕</div>
      <p className="text-lg font-semibold text-danger">
        Verification Failed
      </p>
      <p className="text-sm text-ink-muted">
        {result.message}
      </p>
      <div className="flex flex-col gap-2">
        <Link 
          href={ROUTES.login} 
          className="inline-block w-full rounded-md bg-gray-200 px-4 py-2 text-center text-sm font-semibold text-gray-800 hover:bg-gray-300 transition"
        >
          Go to Log in
        </Link>
        <Link 
          href={ROUTES.register} 
          className="inline-block w-full rounded-md bg-brand px-4 py-2 text-center text-sm font-semibold text-white hover:bg-brand/90 transition"
        >
          Register Again
        </Link>
      </div>
    </div>
  );
}

// ✅ Tumhara original component (bina kisi change ke)
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