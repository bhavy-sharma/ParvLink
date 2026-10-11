import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PhaseBadge } from "@/components/events/event-badges";
import { MatchList } from "@/components/partners/match-list";
import { PartnerCard } from "@/components/partners/partner-card";
import { ProfileToggle } from "@/components/partners/profile-toggle";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Badge, EmptyState, Panel } from "@/components/ui/misc";
import { describeDbError } from "@/lib/auth/errors";
import { eventPaths } from "@/lib/auth/routes";
import { requireProfile } from "@/lib/auth/session";
import { listMyConversations } from "@/lib/data/chat";
import { discoverPartners, getMyParticipation, listReceivedInterests } from "@/lib/data/partners";
import { getStudentEvent } from "@/lib/data/student-events";
import { formatEventRange } from "@/lib/dates";
import { blockerSentences, describeParticipationError, participationState, partnerLabel } from "@/lib/partners";
import { DISCOVERY_PAGE_SIZE } from "@/lib/validation/limits";
import { eventSlugSchema } from "@/lib/validation/schemas";

export const metadata = { title: "Find your partner" };

function brief(text, max = 180) {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, flat.lastIndexOf(" ", max))}…`;
}

export default async function PartnersPage({ params, searchParams }) {
  await requireProfile();
  const parsed = eventSlugSchema.safeParse(await params);
  if (!parsed.success) notFound();

  const event = await getStudentEvent(parsed.data.slug);
  if (!event) notFound();
  const paths = eventPaths(event.slug);

  const me = await getMyParticipation(event.id);
  if (!me) throw new Error("Your status for this event could not be loaded.");
  const state = participationState(me);
  if (state === "not_joined") redirect(paths.join);

  const requestedPage = Number.parseInt((await searchParams).page ?? "1", 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 10000) : 1;

  const [discovery, received, matched] = await Promise.all([
    state === "active" ? discoverPartners(event.id, { page, pageSize: DISCOVERY_PAGE_SIZE }) : null,
    listReceivedInterests(event.id),
    listMyConversations(event.id),
  ]);

  const waiting = received.people.filter((person) => person.relation === "received");
  const pageCount = discovery ? Math.max(1, Math.ceil(discovery.total / DISCOVERY_PAGE_SIZE)) : 1;
  const pageHref = (n) => (n <= 1 ? paths.partners : `${paths.partners}?page=${n}`);

  return (
    <div className="space-y-8">
      <div>
        <Link href={paths.event} className="text-sm font-semibold text-brand underline">
          Back to the event
        </Link>
        <header className="mt-3">
          <p className="flex flex-wrap items-center gap-2">
            <PhaseBadge event={event} />
            <span className="text-sm text-ink-muted">{formatEventRange(event.starts_at, event.ends_at)}</span>
          </p>
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Find your partner: {event.title}</h1>
          <p className="mt-2 max-w-2xl text-ink-muted">{brief(event.description)}</p>
        </header>
      </div>

      {/* --- my status for this event ------------------------------------------------ */}
      <Panel aria-labelledby="my-status">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="my-status" className="flex flex-wrap items-center gap-2 text-xl font-semibold">
              Your profile for this event
              {state === "active" ? <Badge tone="ok">Open</Badge> : state === "closed" ? <Badge tone="warning">Closed</Badge> : <Badge>Ended</Badge>}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              {state === "active" ? (
                <>
                  You are looking for {partnerLabel(me.looking_for)}.{" "}
                  <Link href={paths.join} className="font-semibold text-brand underline">
                    Change
                  </Link>
                </>
              ) : state === "closed" ? (
                "You are hidden from partner discovery for this event, and cannot send or receive new interest. Your matches are kept."
              ) : (
                "This event is no longer taking partners for you. Your matches are kept."
              )}
            </p>
          </div>
          <ProfileToggle slug={event.slug} isOpen={state === "active"} canReopen={state === "closed"} />
        </div>
        {state === "ended" ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-muted">
            {blockerSentences(me.blockers).map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ul>
        ) : null}
      </Panel>

      {/* --- matches ------------------------------------------------------------------ */}
      {matched.conversations.length > 0 ? (
        <section aria-labelledby="matches-heading" className="space-y-3">
          <h2 id="matches-heading" className="text-2xl font-semibold">
            Your matches for this event
          </h2>
          <MatchList matches={matched.conversations} />
        </section>
      ) : null}

      {/* --- interests received ------------------------------------------------------- */}
      <section aria-labelledby="received-heading" className="space-y-3">
        <h2 id="received-heading" className="text-2xl font-semibold">
          Interests received
        </h2>
        {received.error ? (
          <Alert tone="error">
            We could not load the interest you have received. <Link href={paths.partners}>Try again</Link>
          </Alert>
        ) : waiting.length === 0 ? (
          <EmptyState title="No one is waiting for an answer">
            When someone sends you interest for this event, they appear here. Send interest back to make it a match.
          </EmptyState>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {waiting.map((person) => (
              <li key={person.handle}>
                <PartnerCard slug={event.slug} person={person} note="Sent you interest." eventName={event.title} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- discovery ---------------------------------------------------------------- */}
      <section aria-labelledby="discover-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="discover-heading" className="text-2xl font-semibold">
            Students you can partner with
          </h2>
          {discovery && !discovery.error && discovery.total > 0 ? (
            <p className="text-sm text-ink-muted" aria-live="polite">
              {discovery.total === 1 ? "1 student" : `${discovery.total} students`}
              {pageCount > 1 ? `, page ${Math.min(page, pageCount)} of ${pageCount}` : ""}
            </p>
          ) : null}
        </div>

        {state === "closed" ? (
          <EmptyState title="Your profile is closed for this event">
            Re-open it above to see students and be seen again.
          </EmptyState>
        ) : state === "ended" ? (
          <EmptyState title="Partner discovery has ended for this event">Your matches stay on this page and under Matches.</EmptyState>
        ) : discovery.error ? (
          <Alert tone="error" title="We could not load students just now">
            {discovery.error.message === "participation_blocked" ? describeParticipationError(discovery.error) : describeDbError(discovery.error)}{" "}
            <Link href={pageHref(page)}>Try again</Link>
          </Alert>
        ) : discovery.people.length === 0 ? (
          page > 1 ? (
            <EmptyState title="No more students on this page" action={<ButtonLink href={paths.partners} variant="secondary">Back to the first page</ButtonLink>} />
          ) : (
            <EmptyState title="No one to show yet">
              Nobody who has joined this event matches your preference at the moment. More students join as the event gets closer — check back, or{" "}
              <Link href={paths.join} className="font-semibold text-brand underline">
                change who you are looking for
              </Link>
              .
            </EmptyState>
          )
        ) : (
          <>
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {discovery.people.map((person) => (
                <li key={person.handle}>
                  <PartnerCard slug={event.slug} person={person} note={person.relation === "received" ? "Sent you interest." : null} />
                </li>
              ))}
            </ul>
            {pageCount > 1 ? (
              <nav aria-label="Pages of students" className="flex items-center justify-between gap-3 pt-2">
                {page > 1 ? (
                  <ButtonLink href={pageHref(page - 1)} variant="secondary" size="sm">
                    Previous
                  </ButtonLink>
                ) : (
                  <span />
                )}
                {page < pageCount ? (
                  <ButtonLink href={pageHref(page + 1)} variant="secondary" size="sm">
                    Next
                  </ButtonLink>
                ) : null}
              </nav>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
