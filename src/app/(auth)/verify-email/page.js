import Link from "next/link";
import { AuthCard } from "@/components/forms/auth-card";
import { ROUTES } from "@/lib/auth/routes";
import { ResendForm } from "./resend-form";
import { verifyEmailAction } from "../actions";
import { readPendingEmail } from "@/lib/auth/pending-email";

export const metadata = {
  title: "Confirm your email",
};

export default async function VerifyEmailPage({ searchParams }) {
  const params = await searchParams;
  const token =
    typeof params?.token === "string" ? params.token : "";

  // Verify email when a token is present.
  if (token) {
    try {
      const result = await verifyEmailAction(token);

      if (result?.status === "success") {
        return (
          <AuthCard
            title="Email Verified"
            footer={
              <>
                Already verified?{" "}
                <Link href={ROUTES.login}>Log in</Link>
              </>
            }
          >
            <div className="space-y-5 text-center">
              <div className="text-5xl">🎉</div>

              <p className="text-lg font-semibold text-green-600">
                Email Successfully Verified!
              </p>

              <p className="text-sm text-ink-muted">
                {result.message ||
                  "Your email has been verified successfully."}
              </p>

              <Link
                href={ROUTES.login}
                className="inline-block w-full rounded-md bg-brand px-4 py-2 text-center text-sm font-semibold text-white transition hover:bg-brand/90"
              >
                Log in now
              </Link>
            </div>
          </AuthCard>
        );
      }

      return (
        <AuthCard
          title="Verification Failed"
          footer={
            <>
              Already verified?{" "}
              <Link href={ROUTES.login}>Log in</Link>
            </>
          }
        >
          <div className="space-y-5 text-center">
            <div className="text-5xl">😕</div>

            <p className="text-lg font-semibold text-danger">
              Verification Failed
            </p>

            <p className="text-sm text-ink-muted">
              {result?.message ||
                "The verification link is invalid or expired."}
            </p>

            <div className="flex flex-col gap-2">
              <Link
                href={ROUTES.login}
                className="inline-block w-full rounded-md bg-gray-200 px-4 py-2 text-center text-sm font-semibold text-gray-800 transition hover:bg-gray-300"
              >
                Go to Log in
              </Link>

              <Link
                href={ROUTES.register}
                className="inline-block w-full rounded-md bg-brand px-4 py-2 text-center text-sm font-semibold text-white transition hover:bg-brand/90"
              >
                Register Again
              </Link>
            </div>
          </div>
        </AuthCard>
      );
    } catch (error) {
      console.error("Email verification failed:", error);

      return (
        <AuthCard
          title="Verification Failed"
          footer={
            <>
              Already verified?{" "}
              <Link href={ROUTES.login}>Log in</Link>
            </>
          }
        >
          <div className="space-y-5 text-center">
            <p className="text-lg font-semibold text-danger">
              Unable to verify your email
            </p>

            <p className="text-sm text-ink-muted">
              Something went wrong while verifying your email.
              Please request a new verification link or try again.
            </p>

            <div className="flex flex-col gap-2">
              <Link
                href={ROUTES.login}
                className="rounded-md bg-gray-200 px-4 py-2 text-center text-sm font-semibold text-gray-800 transition hover:bg-gray-300"
              >
                Go to Log in
              </Link>

              <Link
                href={ROUTES.register}
                className="rounded-md bg-brand px-4 py-2 text-center text-sm font-semibold text-white transition hover:bg-brand/90"
              >
                Register Again
              </Link>
            </div>
          </div>
        </AuthCard>
      );
    }
  }

  // Read the pending email when no token is provided.
  let email = "";

  try {
    email = (await readPendingEmail()) || "";
  } catch (error) {
    console.error("Unable to read pending email:", error);
  }

  return (
    <AuthCard
      title="Confirm your email"
      footer={
        <>
          Already confirmed?{" "}
          <Link href={ROUTES.login}>Log in</Link>
        </>
      }
    >
      <div className="space-y-5">
        <p>
          {email ? (
            <>
              We sent a confirmation link to{" "}
              <strong className="break-all">{email}</strong>.
            </>
          ) : (
            <>We sent a confirmation link to your email address.</>
          )}{" "}
          Open it on this device to finish creating your account.
        </p>

        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
          <li>The link works once and expires after a while.</li>
          <li>
            Nothing after a few minutes? Check your spam folder,
            then request a new link below.
          </li>
        </ul>

        <ResendForm email={email} />
      </div>
    </AuthCard>
  );
}