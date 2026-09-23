import type { ReactNode } from "react";

/** One clickable action rendered on a needed-item or listing row. */
export interface TermActionVM {
  key: string;
  label: string;
  ariaLabel?: string;
  onClick: () => void;
  disabled?: boolean;
}

/** A "Potrzebne rzeczy" row. `inlineActions` render directly in the row;
 * `extra` is arbitrary content below it (the account-merge mini-form). */
export interface NeededItemRowVM {
  key: string | number;
  title: ReactNode;
  subtitle?: ReactNode | null;
  inlineActions: TermActionVM[];
  extra?: ReactNode;
}

/** One offered item under an attendee: its take-type action buttons, then
 * optional extra content (the swap picker or the account-merge mini-form). */
export interface ListingRowVM {
  key: string | number;
  title: ReactNode;
  subtitle?: ReactNode;
  actions: TermActionVM[];
  extra?: ReactNode;
}

/** DOM id of an attendee's list entry — the scroll/focus target when their
 * avatar is clicked in the group visualization. */
export function attendeeElementId(partyId: number): string {
  return `attendee-${partyId}`;
}
