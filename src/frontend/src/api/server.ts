/* Backend reads made while rendering on the server. They are always
 * anonymous: the session cookie is never forwarded. A failure returns
 * `null`, so the page still renders, with the default metadata. */
import "server-only";
import { cache } from "react";
import { isOrganizationSlug } from "../lib/publicMetadata";
import type { EventDetailResponse } from "./events";
import type { PublicCircleResponse } from "./groups";
import type { ItemDetailsResponse } from "./items";
import type { PublicOrganizationResponse } from "./organizations";

const BACKEND_URL = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8080";
/** A slow backend must not hold the page; past this the page renders with defaults. */
const TIMEOUT_MS = 3000;

/** Memoised per request, so `generateMetadata`, the layout and the page share one fetch. */
export const serverGet = cache(async <T,>(path: string): Promise<T | null> => {
  try {
    const response = await fetch(`${BACKEND_URL}/api${path}`, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
});

export function getPublicOrganizationOnServer(slug: string): Promise<PublicOrganizationResponse | null> {
  if (!isOrganizationSlug(slug)) return Promise.resolve(null);
  return serverGet<PublicOrganizationResponse>(`/public/organizations/${encodeURIComponent(slug)}`);
}

export function getEventOnServer(eventId: string): Promise<EventDetailResponse | null> {
  return serverGet<EventDetailResponse>(`/public/events/${encodeURIComponent(eventId)}`);
}

export function getPublicCircleOnServer(groupId: string, termId: string): Promise<PublicCircleResponse | null> {
  return serverGet<PublicCircleResponse>(
    `/public/groups/${encodeURIComponent(groupId)}?term_id=${encodeURIComponent(termId)}`,
  );
}

/** A listed item as an anonymous visitor sees it; `null` for one that is not public. */
export function getItemOnServer(itemId: string): Promise<ItemDetailsResponse | null> {
  return serverGet<ItemDetailsResponse>(`/public/items/${encodeURIComponent(itemId)}/details`);
}
