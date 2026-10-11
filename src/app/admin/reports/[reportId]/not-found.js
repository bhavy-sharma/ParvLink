import { ButtonLink } from "@/components/ui/button";
import { ROUTES } from "@/lib/auth/routes";

export default function ReportNotFound() {
  return (
    <div className="mx-auto max-w-md pt-6">
      <h1 className="text-3xl font-bold">We could not find that report</h1>
      <p className="mt-2 text-ink-muted">It may not exist, it may concern a college you do not moderate, or it involves you and is handled by someone else.</p>
      <div className="mt-6">
        <ButtonLink href={ROUTES.adminReports}>Back to reports</ButtonLink>
      </div>
    </div>
  );
}
