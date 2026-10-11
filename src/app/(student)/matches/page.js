import { MatchList } from "@/components/partners/match-list";
import { MatchReadMarker } from "@/components/partners/match-read-marker";
import { UnblockButton } from "@/components/partners/unblock-button";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { ROUTES } from "@/lib/auth/routes";
import { requireProfile } from "@/lib/auth/session";
import { listMyConversations } from "@/lib/data/chat";
import { formatDate } from "@/lib/dates";
import { call } from "@/lib/services";

export const metadata = { title: "My matches" };

export default async function MatchesPage() {
  await requireProfile();
  const [{ conversations: matches, error }, blocks] = await Promise.all([listMyConversations(), call("list_my_blocks")]);

  return (
    <div className="space-y-8">
      <MatchReadMarker />
      <PageHeader title="My matches" description="A match is made when you and another student send each other interest for the same event. Once matched, the two of you can chat here." />

      {error ? (
        <Alert tone="error">We could not load your matches. Reload the page to try again.</Alert>
      ) : matches.length === 0 ? (
        <EmptyState title="No matches yet" action={<ButtonLink href={ROUTES.events}>Browse events</ButtonLink>}>
          Open an event, choose “Find your partner”, and send interest to students you would like to team up with.
        </EmptyState>
      ) : (
        <section aria-label="Matches" className="space-y-3">
          <MatchList matches={matches} showEvent />
          <p className="text-sm text-ink-muted">Only you and your match can open a conversation. Most recent first.</p>
        </section>
      )}

      <section aria-labelledby="blocked-heading" className="space-y-3">
        <h2 id="blocked-heading" className="text-2xl font-semibold">
          People you have blocked
        </h2>
        {blocks.error ? (
          <Alert tone="error">We could not load this list. Reload the page to try again.</Alert>
        ) : (blocks.data ?? []).length === 0 ? (
          <p className="text-sm text-ink-muted">Nobody. You can block someone from their card in an event’s partner page.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-panel border border-line bg-surface">
            {blocks.data.map((block) => (
              <li key={block.block_id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <p>
                  <span className="font-semibold">{block.first_name}</span>
                  <span className="text-sm text-ink-muted">
                    , {block.course}. Blocked on {formatDate(block.blocked_at)}
                  </span>
                </p>
                <UnblockButton blockId={block.block_id} name={block.first_name} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
