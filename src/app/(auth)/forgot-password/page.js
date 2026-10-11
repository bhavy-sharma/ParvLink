import Link from "next/link";
import { AuthCard } from "@/components/forms/auth-card";
import { ROUTES } from "@/lib/auth/routes";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Forgot your password?"
      description="Enter the email you registered with. We will send a link for choosing a new password."
      footer={
        <>
          Remembered it? <Link href={ROUTES.login}>Log in</Link>
        </>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
