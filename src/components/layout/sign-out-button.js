import { logoutAction } from "@/app/(auth)/actions";
import { SubmitButton } from "@/components/forms/submit-button";

export function SignOutButton({ variant = "secondary", size = "sm", className }) {
  return (
    <form action={logoutAction}>
      <SubmitButton variant={variant} size={size} className={className} pendingLabel="Logging out…">
        Log out
      </SubmitButton>
    </form>
  );
}
