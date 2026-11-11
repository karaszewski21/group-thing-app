import type { OrganizationGroupTermsResponse, PublicOrganizationResponse } from "../../api/organizations";

export const GROUP_TERMS_LOAD_ERROR = "Nie udało się wczytać terminów grupy.";

/** The one screen `/:slug/group/:groupId/terms` shows. `notFound` and
 * `error` are handed to the route's `not-found.tsx` and `error.tsx`. */
export type GroupTermsView =
  | { kind: "loading" }
  | { kind: "content"; organization: PublicOrganizationResponse; page: OrganizationGroupTermsResponse }
  | { kind: "notFound" }
  | { kind: "error"; message: string };

interface Read<T> {
  data: T | null;
  loading: boolean;
  notFound: boolean;
  error: string | null;
}

/** First match wins: a 404 of either read, both loaded (a failed refresh
 * keeps them on screen), then a failed first read, else loading. */
export function resolveGroupTermsView({
  organization,
  group,
}: {
  organization: Read<PublicOrganizationResponse>;
  group: Read<OrganizationGroupTermsResponse>;
}): GroupTermsView {
  if (organization.notFound || group.notFound) return { kind: "notFound" };
  if (organization.data && group.data) {
    return { kind: "content", organization: organization.data, page: group.data };
  }
  if (organization.error || group.error) return { kind: "error", message: GROUP_TERMS_LOAD_ERROR };
  return { kind: "loading" };
}
