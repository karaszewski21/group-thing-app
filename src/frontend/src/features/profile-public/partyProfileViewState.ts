import type { PartyProfileResponse } from "../../api/ownerItems";

export const PARTY_PROFILE_LOAD_ERROR = "Nie udało się wczytać profilu.";

/** The one screen `/:partyId` shows. `notFound` and `error` are handed to
 * the route's `not-found.tsx` and `error.tsx`. */
export type PartyProfileView =
  | { kind: "loading" }
  | { kind: "redirect"; to: string }
  | { kind: "content"; profile: PartyProfileResponse }
  | { kind: "notFound" }
  | { kind: "error"; message: string };

interface PartyProfilePageState {
  data: PartyProfileResponse | null;
  loading: boolean;
  notFound: boolean;
  error: string | null;
}

/** First match wins: a 404 (nothing public), an Organization owner sent to
 * the Organization's page, the loaded profile (a failed refresh keeps it on
 * screen), then a failed first read and loading. */
export function resolvePartyProfileView({ data, loading, notFound, error }: PartyProfilePageState): PartyProfileView {
  if (notFound) return { kind: "notFound" };
  if (data) {
    const slug = data.owner.slug;
    if (slug) return { kind: "redirect", to: `/${slug}` };
    return { kind: "content", profile: data };
  }
  if (error) return { kind: "error", message: PARTY_PROFILE_LOAD_ERROR };
  if (loading) return { kind: "loading" };
  return { kind: "notFound" };
}
