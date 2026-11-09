import { createContext, useContext } from "react";
import type { OwnerMeetingsResponse } from "../../api/ownerItems";

/** What every block of a loaded owner meetings page reads: the owner and
 * their upcoming terms and events, earliest first. */
export interface OwnerMeetingsPageValue {
  owner: OwnerMeetingsResponse["owner"];
  meetings: OwnerMeetingsResponse["meetings"];
}

export const OwnerMeetingsPageContext = createContext<OwnerMeetingsPageValue | null>(null);

export function useOwnerMeetingsPage(): OwnerMeetingsPageValue {
  const value = useContext(OwnerMeetingsPageContext);
  if (value === null) throw new Error("Owner meetings blocks render only inside <OwnerMeetingsPage>");
  return value;
}

/** A failed owner or Organization read, thrown by `OwnerMeetingsPage` to the
 * route's `error.tsx`. */
export class OwnerMeetingsLoadError extends Error {}
