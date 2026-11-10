import type { OwnerMeetingsResponse } from "../../api/ownerItems";
import type { PublicOrganizationResponse } from "../../api/organizations";

export const OWNER_MEETINGS_LOAD_ERROR = "Nie udało się wczytać spotkań.";

/** The one screen `/:slug/meetings` shows. `notFound` and `error` are handed
 * to the route's `not-found.tsx` and `error.tsx`. */
export type OwnerMeetingsView =
  | { kind: "loading" }
  | {
      kind: "content";
      owner: OwnerMeetingsResponse["owner"];
      meetings: OwnerMeetingsResponse["meetings"];
      organization: PublicOrganizationResponse | null;
    }
  | { kind: "notFound" }
  | { kind: "error"; message: string };

interface OwnerMeetingsPageState {
  /** The Organization read for an Organization slug; `null` for a party id. */
  organization: {
    data: PublicOrganizationResponse | null;
    loading: boolean;
    notFound: boolean;
    error: string | null;
  } | null;
  meetings: {
    owner: OwnerMeetingsResponse["owner"] | null;
    meetings: OwnerMeetingsResponse["meetings"];
    loading: boolean;
    notFound: boolean;
    error: string | null;
  };
}

/** First match wins: the Organization must load first, then the meetings read
 * decides between loading, not found, error and content. */
export function resolveOwnerMeetingsView({
  organization,
  meetings,
}: OwnerMeetingsPageState): OwnerMeetingsView {
  if (organization) {
    if (organization.loading) return { kind: "loading" };
    if (organization.notFound) return { kind: "notFound" };
    if (organization.error || !organization.data) return { kind: "error", message: OWNER_MEETINGS_LOAD_ERROR };
  }
  if (meetings.loading) return { kind: "loading" };
  if (meetings.notFound) return { kind: "notFound" };
  if (meetings.error || !meetings.owner) return { kind: "error", message: OWNER_MEETINGS_LOAD_ERROR };
  return {
    kind: "content",
    owner: meetings.owner,
    meetings: meetings.meetings,
    organization: organization?.data ?? null,
  };
}
