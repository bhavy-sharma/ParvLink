import Link from "next/link";
import { AuthCard } from "@/components/forms/auth-card";
import { ROUTES } from "@/lib/auth/routes";
import { ResendForm } from "./resend-form";
import { verifyEmailAction } from "../actions";
import { cookies } from "next/headers"; // ✅ Safe dynamic bailout

export const metadata = { title: "Confirm your email" };

export default async function VerifyEmailPage(props) {
  // ✅ 1. Ye line Next.js ko batati hai ki ye page dynamic hai. 
  // Ye 'cacheComponents' ke rules ko follow karta hai aur build crash nahi karega.
  await cookies();

  // ✅ 2. Safely resolve searchParams
  const searchParams = await props.searchParams;
  const token = searchParams?.token;

  // ✅ 3. Token Verification Logic (Wrapped in Try-Catch)
  if (token) {
    try {
      const result = await verifyEmailAction(token);
      
      if (result.status === "success") {
        return (
          <AuthCard title="Email Verified" footer={<>Already verified? <Link href={ROUTES.login}>Log in</Link></>}>
            <div className="space-y-5 text-center">
              <div className="text-5xl">🎉</div>
              <p className="text-lg font-semibold text-green-600">Email Successfully Verified!</p>
              <p className="text-sm text-ink-muted">{result.message}</p>
              <Link href={ROUTES.login} className="inline-block w-full rounded-md bg-brand px-4 py-2 text-center text-sm font-semibold text-white hover:bg-brand/90 transition">
                Log in now
              </Link>
            </div>
          </AuthCard>
        );
      }

      return (
        <AuthCard title="Verification Failed" footer={<>Already verified? <Link href={ROUTES.login}>Log in</Link></>}>
          <div className="space-y-5 text-center">
            <div className="text-5xl">😕</div>
            <p className="text-lg font-semibold text-danger">Verification Failed</p>
            <p className="text-sm text-ink-muted">{result.message}</p>
            <div className="flex flex-col gap-2">
              <Link href={ROUTES.login} className="inline-block w-full rounded-md bg-gray-200 px-4 py-2 text-center text-sm font-semibold text-gray-800 hover:bg-gray-300 transition">Go to Log in</Link>
              <Link href={ROUTES.register} className="inline-block w-full rounded-md bg-brand px-4 py-2 text-center text-sm font-semibold text-white hover:bg-brand/90 transition">Register Again</Link>
            </div>
          </div>
        </AuthCard>
      );
    } catch (err) {
      console.error("Verification action failed:", err);
      // Fallback to generic message if action fails
    }
  }

  // ✅ 4. Normal "Check Email" State (With Maximum Safety)
  let email = "";
  try {
    // Dynamic import taaki build time par ye module load na ho agar zaroorat na ho
    const { readPendingEmail } = await import("@/lib/auth/pending-email");
    email = (await readPendingEmail()) || "";
  } catch (err) {
    // Build time par agar ye fail hota hai, toh app crash nahi hogi, bas empty email use hoga
    console.warn("Skipped readPendingEmail during build (safe fallback)");
  }

  return (
    <AuthCard
      title="Confirm your email"
      footer={<>Already confirmed? <Link href={ROUTES.login}>Log in</Link></>}
    >
      <div className="space-y-5">
        <p>
          {email ? (
            <>We sent a confirmation link to <strong className="break-all">{email}</strong>.</>
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
    </AuthCard>
  );
}