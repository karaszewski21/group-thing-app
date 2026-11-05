import { createContext, useContext } from "react";
import type { TermContentView } from "./termViewState";

/** What every block of a term page the caller may see reads: the one content
 * view (blocks never re-derive it), the viewer, and the attendee picked in
 * the visualization. */
export interface TermPageValue {
  view: TermContentView;
  isLoggedIn: boolean;
  displayName: string | null;
  refetch: () => Promise<void>;
  showToast: (message: string) => void;
  activePartyId: string | null;
  selectAttendee: (partyId: string) => void;
}

export const TermPageContext = createContext<TermPageValue | null>(null);

export function useTermPage(): TermPageValue {
  const value = useContext(TermPageContext);
  if (value === null) throw new Error("Term page blocks render only inside <TermPage>");
  return value;
}

/** A failed `/access` read other than "no such term", thrown by `TermPage` to
 * the route's `error.tsx`. */
export class TermLoadError extends Error {}
