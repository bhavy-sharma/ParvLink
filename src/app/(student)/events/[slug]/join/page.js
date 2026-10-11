import Link from "next/link";
import { notFound } from "next/navigation";
import { JoinForm } from "@/components/partners/join-form";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader, Panel } from "@/components/ui/misc";
import { eventPaths } from "@/lib/auth/routes";
import { requireProfile } from "@/lib/auth/session";
import { getMyParticipation } from "@/lib/data/partners";
import { getStudentEvent } from "@/lib/data/student-events";
import { blockerSentences } from "@/lib/partners";
import { eventSlugSchema } from "@/lib/validation/schemas";

export const metadata = { title: "Find your partner" };

export default async function JoinEventPage({ params }) {
  await requireProfile();
  const parsed = eventSlugSchema.safeParse(await params);
  if (!parsed.success) notFound();

  const event = await getStudentEvent(parsed.data.slug);
  if (!event) notFound();
  const paths = eventPaths(event.slug);

  const me = await getMyParticipation(event.id);
  if (!me) throw new Error("Your status for this event could not be loaded.");
  const blockers = me.blockers ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href={paths.event} className="text-sm font-semibold text-brand underline">
        Back to the event
      </Link>
      <PageHeader
        title={me.joined ? "Change your preference" : "Find your partner"}
        description={event.title}
      />

      {blockers.length > 0 ? (
        <>
          <Alert tone="warning" title="You cannot take part in this event right now">
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {blockerSentences(blockers).map((sentence) => (
                <li key={sentence}>{sentence}</li>
              ))}
            </ul>
          </Alert>
          <ButtonLink href={paths.event} variant="secondary">
            Back to the event
          </ButtonLink>
        </>
      ) : (
        <Panel as="div">
          <JoinForm
            slug={event.slug}
            eventTitle={event.title}
            savedGender={me.gender}
            currentLookingFor={me.looking_for}
            cancelHref={me.joined ? paths.partners : paths.event}
          />
        </Panel>
      )}
    </div>
  );
}
