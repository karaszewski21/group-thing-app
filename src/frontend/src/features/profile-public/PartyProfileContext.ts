import { createContext, useContext } from "react";
import type { PartyProfileResponse } from "../../api/ownerItems";

/** What every block of a loaded person profile reads: the profile and
 * whether it has upcoming terms and listed items (never re-derived). */
export interface PartyProfilePageValue {
  profile: PartyProfileResponse;
  hasTerms: boolean;
  hasItems: boolean;
}

export const PartyProfilePageContext = createContext<PartyProfilePageValue | null>(null);

export function usePartyProfilePage(): PartyProfilePageValue {
  const value = useContext(PartyProfilePageContext);
  if (value === null) throw new Error("Party profile blocks render only inside <PartyProfilePage>");
  return value;
}

/** A failed first read, thrown by `PartyProfilePage` to the route's
 * `error.tsx`, which shows its message. */
export class PartyProfileLoadError extends Error {}
