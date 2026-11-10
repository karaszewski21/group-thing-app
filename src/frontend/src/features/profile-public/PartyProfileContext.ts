import { createContext, useContext } from "react";
import type { PartyProfileResponse } from "../../api/ownerItems";

/** What every block of a loaded person profile reads. */
export interface PartyProfilePageValue {
  profile: PartyProfileResponse;
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
