import { ButtonLink } from "@/components/ui/button";
import { ROUTES } from "@/lib/auth/routes";

export const metadata = { title: "Account deleted", robots: { index: false } };

// Shown after a deletion has actually been carried out (the action redirects
// here only when the database reported "deleted").
export default function GoodbyePage() {
  return (
    <div className="pt-8">
      <h1 className="text-4xl font-bold">Your account has been deleted</h1>
      <p className="mt-4 text-ink-muted">
        Your sign-in record, profile, event participation, matches and conversations have been removed, and you have been logged out. Reports and the administrators’ activity log are kept
        without your name, as the privacy notice explains.
      </p>
      <p className="mt-3 text-ink-muted">If you had a profile photo, it has been removed too.</p>
      <p className="mt-3 text-ink-muted">Copies in routine database backups disappear when those backups expire.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink href={ROUTES.home}>Back to the start page</ButtonLink>
        <ButtonLink href={ROUTES.privacy} variant="secondary">
          Privacy notice
        </ButtonLink>
      </div>
    </div>
  );
}
