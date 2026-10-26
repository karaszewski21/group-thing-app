import type { ExchangeMode } from "../../../api/groups";
import type { ListingMode } from "../../../api/itemListingPreferences";

/** The modes an item listing can offer, in take-button order. */
export const LISTABLE_RESERVATION_TYPES: ListingMode[] = ["SWAP", "GIFT"];

/** Take-button labels on an attendee's offered items. */
export const TAKE_ACTION_LABELS: Record<ListingMode, string> = {
  SWAP: "Zamień",
  GIFT: "Weź na stałe",
};

/** Exchange directory labels per listing mode (organizer public page). */
export const EXCHANGE_MODE_LABELS: Record<ExchangeMode, string> = {
  GIFT: "Oddam",
  SWAP: "Zamienię",
};

/** Soft background plus a readable foreground per exchange mode. */
export const EXCHANGE_MODE_TONE: Record<ExchangeMode, string> = {
  GIFT: "bg-primary-soft text-primary-fg",
  SWAP: "bg-accent-soft text-accent-fg",
};
