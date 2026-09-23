import type { ReactNode } from "react";

/** One clickable action rendered inline on a needed-item/listing row
 * (`NeededItemsSection`/`ListingsSection`) — both `PrivateTermView` and
 * `PublicTermView` build these from their own data + `gateAction`-wrapped
 * handlers; the sections themselves never know which view they're in. */
export interface TermActionVM {
  key: string;
  label: string;
  ariaLabel?: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}

/** A needed-item ("kto co przynosi" / "potrzebne rzeczy") row. `avatar`
 * `undefined` renders no avatar element at all (the public view never shows
 * one); `null` renders the empty dashed placeholder; an object renders the
 * colored family avatar (private view only). `inlineActions` render directly
 * in the row (0-2 buttons); `extra` is arbitrary content below the row
 * (the private fulfil mini-form, or the public account-merge mini-form). */
export interface NeededItemRowVM {
  key: string | number;
  avatar?: { initials: string; color: string } | null;
  title: ReactNode;
  subtitle?: ReactNode | null;
  inlineActions: TermActionVM[];
  extra?: ReactNode;
  statusLine?: string | null;
  confirmAction?: TermActionVM | null;
}

/** A listing ("twoje wystawione rzeczy" / "rzeczy od innych" / "rzeczy do
 * wymiany") row — always body-only, then a wrapped row of take-type action
 * buttons (if any), then optional extra content (the swap-select mini-form)
 * and an optional confirm-receipt action. */
export interface ListingRowVM {
  key: string | number;
  title: ReactNode;
  subtitle?: ReactNode;
  actions: TermActionVM[];
  extra?: ReactNode;
  statusLine?: string | null;
  confirmAction?: TermActionVM | null;
}

export interface TermSectionVM<Row> {
  heading: string;
  subtitleText?: string;
  emptyNode?: ReactNode;
  rows: Row[];
  headingStyle?: React.CSSProperties;
}
