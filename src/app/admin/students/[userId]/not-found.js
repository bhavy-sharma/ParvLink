import { ButtonLink } from "@/components/ui/button";
import { ROUTES } from "@/lib/auth/routes";

export default function StudentNotFound() {
  return (
    <div className="mx-auto max-w-md pt-6">
      <h1 className="text-3xl font-bold">We could not find that student</h1>
      <p className="mt-2 text-ink-muted">The account may not exist, or it belongs to a college whose students you cannot see.</p>
      <div className="mt-6">
        <ButtonLink href={ROUTES.adminUsers}>Back to students</ButtonLink>
      </div>
    </div>
  );
}
