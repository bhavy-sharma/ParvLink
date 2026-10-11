import Link from "next/link";
import { AuthCard } from "@/components/forms/auth-card";
import { ROUTES } from "@/lib/auth/routes";
import { MIN_AGE } from "@/lib/validation/limits";
import { RegisterForm } from "./register-form";

export const metadata = { title: "Create an account" };

export default function RegisterPage() {
  return (
    <AuthCard
      title="Create an account"
      description={`For students aged ${MIN_AGE} and over. You choose your college in the next step.`}
      footer={
        <>
          Already registered? <Link href={ROUTES.login}>Log in</Link>
        </>
      }
    >
      <RegisterForm />
    </AuthCard>
  );
}
