import { PageHeader, Panel } from "@/components/ui/misc";
import { SupportEmail } from "@/components/legal/legal-page";
import { requireUser } from "@/lib/auth/session";
import { FeedbackForm } from "./feedback-form";

export const metadata = { title: "Send feedback" };

export default async function FeedbackPage() {
  await requireUser();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Send feedback"
        description="Tell the team what is broken, confusing or missing. Only the people who run Campus Partner Finder read this — not other students, and not your college’s admins."
      />
      <Notice />
      <Panel>
        <FeedbackForm />
      </Panel>
    </div>
  );
}

function Notice() {
  return (
    <p className="rounded-field border border-marigold/60 bg-marigold-soft px-4 py-3 text-sm text-marigold-ink [&_a]:font-semibold [&_a]:underline">
      This form is not for reporting a person. To report a student, use “Report” on their profile or in the conversation — that reaches the moderators. Nobody replies to
      feedback individually; for something that needs an answer, write to <SupportEmail />.
    </p>
  );
}
