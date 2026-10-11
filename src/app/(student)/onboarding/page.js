import { redirect } from "next/navigation";
import { EmptyState, PageHeader, Panel } from "@/components/ui/misc";
import { ROUTES } from "@/lib/auth/routes";
import { getMyProfile, requireUser } from "@/lib/auth/session";
import { listActiveColleges } from "@/lib/data/colleges";
import { latestDobForAge } from "@/lib/dates";
import { MAX_AGE, MIN_AGE } from "@/lib/validation/limits";
import { OnboardingForm } from "./onboarding-form";

export const metadata = { title: "Create your profile" };

export default async function OnboardingPage() {
  await requireUser();
  if (await getMyProfile()) redirect(ROUTES.dashboard);

  const colleges = await listActiveColleges();

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <PageHeader
        title="Create your profile"
        description="This is what other students at your college see when they look for someone to enter an event with."
      />
      {colleges.length === 0 ? (
        <EmptyState title="No colleges are open yet">
          ParvLink has not been switched on for any college so far. Check back soon — you can create your profile as soon as yours is added.
        </EmptyState>
      ) : (
        <Panel as="div">
          <OnboardingForm colleges={colleges} latestDob={latestDobForAge(MIN_AGE)} earliestDob={latestDobForAge(MAX_AGE)} />
        </Panel>
      )}
    </div>
  );
}
