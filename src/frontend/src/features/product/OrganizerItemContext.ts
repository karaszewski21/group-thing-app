import { createContext, useContext } from "react";
import type { PublicOrganizationResponse } from "../../../api/organizations";

/** The organizer whose palette frames an item page: set by
 * `OrganizerItemLayout` (`null` for a party id prefix, an unknown
 * organization or a failed read), `undefined` outside it. */
export const OrganizerItemContext = createContext<PublicOrganizationResponse | null | undefined>(undefined);

export function useOrganizerItemOrganization(): PublicOrganizationResponse | null | undefined {
  return useContext(OrganizerItemContext);
}
