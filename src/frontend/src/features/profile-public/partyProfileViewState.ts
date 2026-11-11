import type { PartyProfileResponse } from "../../api/ownerItems";

export const PARTY_PROFILE_LOAD_ERROR = "Nie udało się wczytać profilu.";

/** The one screen `/:partyId` shows. `notFound` and `error` are handed to
 * the route's `not-found.tsx` and `error.tsx`. */
export type PartyProfileView =
  | { kind: "loading" }
  /** `hasTerms`: a public term or event is coming up; `hasItems`: anything
   * is listed to give away or swap. The empty boxes follow from these. */
  | { kind: "content"; profile: PartyProfileResponse; hasTerms: boolean; hasItems: boolean }
  | { kind: "notFound" }
  | { kind: "error"; message: string };

interface PartyProfilePageState {
  data: PartyProfileResponse | null;
  loading: boolean;
  notFound: boolean;
  error: string | null;
}

/** First match wins: a 404 (nothing public), the loaded profile (a failed
 * refresh keeps it on screen), then a failed first read and loading. An
 * Organization owner keeps their own profile: it is the person's page. */
export function resolvePartyProfileView({ data, loading, notFound, error }: PartyProfilePageState): PartyProfileView {
  if (notFound) return { kind: "notFound" };
  if (data) {
    return {
      kind: "content",
      profile: data,
      hasTerms: data.nearest !== null,
      hasItems: data.counts.GIFT + data.counts.SWAP > 0,
    };
  }
  if (error) return { kind: "error", message: PARTY_PROFILE_LOAD_ERROR };
  if (loading) return { kind: "loading" };
  return { kind: "notFound" };
}
