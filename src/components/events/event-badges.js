import { Badge } from "@/components/ui/misc";
import { eventPhase, eventStatusLabel, eventTypeLabel, PHASES, STATUS_TONES } from "@/lib/events";

/** Admin view: the stored status. */
export function StatusBadge({ status }) {
  return <Badge tone={STATUS_TONES[status] ?? "neutral"}>{eventStatusLabel(status)}</Badge>;
}

/** Student view: what the event is doing right now (open, closed, …). */
export function PhaseBadge({ event }) {
  const phase = PHASES[eventPhase(event)];
  return <Badge tone={phase.tone}>{phase.label}</Badge>;
}

export function TypeBadge({ type }) {
  return <Badge tone="brand">{eventTypeLabel(type)}</Badge>;
}
