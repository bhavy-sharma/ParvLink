import Link from "next/link";
import { notFound } from "next/navigation";
import { EventDetails } from "@/components/events/event-details";
import { ButtonLink } from "@/components/ui/button";
import { CheckIcon } from "@/components/ui/icons";
import { Badge, Panel } from "@/components/ui/misc";
import { describeDbError, logServerError } from "@/lib/auth/errors";
import { eventPaths, ROUTES } from "@/lib/auth/routes";
import { requireProfile } from "@/lib/auth/session";
import { getCollegeNames } from "@/lib/data/events";
import { getMyParticipation } from "@/lib/data/partners";
import { getStudentEvent } from "@/lib/data/student-events";
import { BLOCKER_MESSAGES, isTimingBlocker } from "@/lib/events";
import { participationState, partnerLabel } from "@/lib/partners";
import { call } from "@/lib/services";
import { eventSlugSchema } from "@/lib/validation/schemas";

export const metadata = { title: "Event" };

export default async function EventPage({ params }) {
  const { profile } = await requireProfile();
  const parsed = eventSlugSchema.safeParse(await params);
  if (!parsed.success) notFound();

  const event = await getStudentEvent(parsed.data.slug);
  // Not found and "not for your college" look exactly the same.
  if (!event) notFound();

  const [collegeNames, me, check] = await Promise.all([
    getCollegeNames(event),
    getMyParticipation(event.id),
    // The database works this out from the student's own profile and private
    // date of birth; nothing about the student is sent from here.
    call("event_participation_check", { p_event_id: event.id }),
  ]);
  if (check.error) logServerError("events.participation_check", check.error);

  return (
    <div className="space-y-6">
      <Link href={ROUTES.events} className="text-sm font-semibold text-brand underline">
        Back to events
      </Link>
      <EventDetails
        event={event}
        collegeNames={collegeNames}
        aside={<ParticipationPanel result={check.data} error={check.error} profile={profile} me={me} paths={eventPaths(event.slug)} />}
      />
    </div>
  );
}

function ParticipationPanel({ result, error, profile, me, paths }) {
  const state = participationState(me);
  if (error || !result) {
    return (
      <Panel aria-labelledby="participation-heading">
        <h2 id="participation-heading" className="text-xl font-semibold">
          Can you take part?
        </h2>
        <p className="mt-2 text-sm text-ink-muted">We could not check this just now ({describeDbError(error)}). Reload the page to try again.</p>
      </Panel>
    );
  }

  const blockers = result.blockers ?? [];
  const aboutYou = blockers.filter((code) => !isTimingBlocker(code));
  const aboutEvent = blockers.filter(isTimingBlocker);

  return (
    <Panel aria-labelledby="participation-heading" className={result.can_participate ? "border-ok/40" : ""}>
      <h2 id="participation-heading" className="text-xl font-semibold">
        {state === "not_joined" ? "Can you take part?" : "Your partner search"}
      </h2>

      {state !== "not_joined" ? (
        // Already joined: where they stand, and the way to their partner page.
        <>
          <p className="mt-3 font-semibold">
            {state === "active"
              ? `You have joined, looking for ${partnerLabel(me.looking_for)}.`
              : state === "closed"
                ? "You joined, and your profile is closed for this event."
                : "You joined this event. It is no longer taking partners."}
          </p>
          <div className="mt-4">
            <ButtonLink href={paths.partners}>{state === "active" ? "Open partner discovery" : "See your partner page"}</ButtonLink>
          </div>
        </>
      ) : result.can_participate ? (
        <>
          <p className="mt-3 flex items-start gap-2 font-semibold text-ok">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-ok text-white">
              <CheckIcon className="size-3.5" />
            </span>
            Yes. You meet every requirement.
          </p>
          <p className="mt-3 text-sm text-ink-muted">Join to see other students looking for a partner for this event, and to be seen by them.</p>
          <div className="mt-4">
            <ButtonLink href={paths.join}>Find Your Partner</ButtonLink>
          </div>
        </>
      ) : (
        <>
          <p className="mt-3 font-semibold">{aboutYou.length > 0 ? "Not yet. Here is why:" : "Not right now."}</p>
          <ul className="mt-2 space-y-2 text-sm">
            {[...aboutYou, ...aboutEvent].map((code) => {
              const message = BLOCKER_MESSAGES[code] ?? { text: "A requirement for this event is not met." };
              return (
                <li key={code} className="flex gap-2">
                  <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-danger" />
                  <span>
                    {message.text}{" "}
                    {message.action === "profile" ? (
                      <Link href={ROUTES.profile} className="font-semibold text-brand underline">
                        Add a photo
                      </Link>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
          {aboutYou.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">You meet the requirements for students; the event itself is not taking participants.</p>
          ) : null}
        </>
      )}

      <dl className="mt-5 border-t border-line pt-4 text-sm">
        <dt className="font-semibold">Checked against your profile</dt>
        <dd className="mt-1 text-ink-muted">
          {profile.colleges?.name ?? "Your college"}, {profile.course}, year {profile.study_year}.{" "}
          <Link href={ROUTES.profile} className="font-semibold text-brand underline">
            View profile
          </Link>
        </dd>
        <dd className="mt-2">
          {result.is_verified ? (
            <Badge tone="ok">Verified by your college</Badge>
          ) : (
            <span className="text-ink-muted">Your college has not verified your profile yet. Verification is not required to take part at the moment.</span>
          )}
        </dd>
      </dl>
    </Panel>
  );
}
