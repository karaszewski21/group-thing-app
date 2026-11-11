import { createContext, useContext } from "react";
import type { OrganizationGroupTermsResponse } from "../../api/organizations";

/** What every block of a loaded group page reads. */
export const GroupTermsPageContext = createContext<OrganizationGroupTermsResponse | null>(null);

export function useGroupTermsPage(): OrganizationGroupTermsResponse {
  const value = useContext(GroupTermsPageContext);
  if (value === null) throw new Error("Group terms blocks render only inside <GroupTermsPage>");
  return value;
}

/** A failed Organization or group read, thrown by `GroupTermsPage` to the
 * route's `error.tsx`. */
export class GroupTermsLoadError extends Error {}
