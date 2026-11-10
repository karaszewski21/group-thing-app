import type { PublicOrganizationResponse } from "../../api/organizations";
import type { DirectoryStatus } from "./layouts/types";

export const ORGANIZATION_PAGE_LOAD_ERROR = "Nie udało się wczytać strony organizacji.";

/** A failed first read, thrown by `PublicOrganizationPage` to the route's
 * `error.tsx`, which shows its message. */
export class OrganizationPageLoadError extends Error {}

/** The one screen `/:slug` shows for an Organization. `notFound` and `error`
 * are handed to the route's `not-found.tsx` and `error.tsx`. */
export type OrganizationPageView =
  | { kind: "loading" }
  | { kind: "content"; organization: PublicOrganizationResponse }
  | { kind: "notFound" }
  | { kind: "error"; message: string };

interface OrganizationPageState {
  data: PublicOrganizationResponse | null;
  loading: boolean;
  notFound: boolean;
  error: string | null;
}

/** First match wins: a 404, the loaded Organization (a failed refresh keeps
 * it on screen), then a failed first read and loading. The directory never
 * decides the screen; its blocks show their own state. */
export function resolveOrganizationPageView({
  data,
  loading,
  notFound,
  error,
}: OrganizationPageState): OrganizationPageView {
  if (notFound) return { kind: "notFound" };
  if (data) return { kind: "content", organization: data };
  if (error) return { kind: "error", message: ORGANIZATION_PAGE_LOAD_ERROR };
  if (loading) return { kind: "loading" };
  return { kind: "notFound" };
}

/** The directory read as the layout blocks see it. */
export function directoryStatusOf({
  loading,
  notFound,
  error,
}: {
  loading: boolean;
  notFound: boolean;
  error: string | null;
}): DirectoryStatus {
  if (loading) return "loading";
  return notFound || error !== null ? "unavailable" : "ready";
}
