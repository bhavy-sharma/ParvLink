import "server-only";

// Reads for the partner-finding pages. Every one is a service that answers
// only about the signed-in caller; see src/lib/services/partners.js.

import { call } from "@/lib/services";

/** The caller's own state for an event, or null if it cannot be read. */
export async function getMyParticipation(eventId) {
  const { data, error } = await call("my_event_participation", { p_event_id: eventId });
  if (error) return null;
  return data;
}

export async function discoverPartners(eventId, { page, pageSize }) {
  const { data, error } = await call("discover_event_partners", { p_event_id: eventId, p_limit: pageSize, p_offset: (page - 1) * pageSize });
  if (error) return { error, people: [], total: 0 };
  return { error: null, people: data ?? [], total: Number(data?.[0]?.total ?? 0) };
}

export async function listReceivedInterests(eventId) {
  const { data, error } = await call("list_received_interests", { p_event_id: eventId });
  return { error, people: error ? [] : (data ?? []) };
}

export async function getMyReceivedInterestCounts() {
  const { data, error } = await call("my_received_interest_counts");
  return { error, events: error ? [] : (data ?? []) };
}
