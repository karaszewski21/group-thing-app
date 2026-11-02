/* Backend reads made while rendering on the server. They are always
 * anonymous: the session cookie is never forwarded. A failure returns
 * `null`, so the page still renders, with the default metadata. */
import "server-only";
import { cache } from "react";
import { isOrganizationSlug } from "../lib/publicMetadata";
import type { EventDetailResponse } from "./events";
import type { PublicCircleResponse } from "./groups";
import type { PublicOrganizationResponse } from "./organizations";

const BACKEND_URL = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8080";

/** Memoised per request, so `generateMetadata`, the layout and the page share one fetch. */
export const serverGet = cache(async <T,>(path: string): Promise<T | null> => {
  try {
    const response = await fetch(`${BACKEND_URL}/api${path}`, { cache: "no-store" });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
});

export function getPublicOrganizationOnServer(slug: string): Promise<PublicOrganizationResponse | null> {
  if (!isOrganizationSlug(slug)) return Promise.resolve(null);
  return serverGet<PublicOrganizationResponse>(`/organizations/public/${encodeURIComponent(slug)}`);
}

export function getEventOnServer(eventId: string): Promise<EventDetailResponse | null> {
  return serverGet<EventDetailResponse>(`/events/${encodeURIComponent(eventId)}`);
}

export function getPublicCircleOnServer(groupId: string, termId: string): Promise<PublicCircleResponse | null> {
  return serverGet<PublicCircleResponse>(
    `/groups/public/${encodeURIComponent(groupId)}?term_id=${encodeURIComponent(termId)}`,
  );
}
