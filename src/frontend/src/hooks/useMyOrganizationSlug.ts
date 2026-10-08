import { useMyOrganization } from "./useMyOrganization";

/** The logged-in caller's own Organization slug, or `null` when they have
 * none yet or nobody is logged in. Shares `useMyOrganization`'s cache. */
export function useMyOrganizationSlug(): string | null {
  return useMyOrganization().data?.slug ?? null;
}
