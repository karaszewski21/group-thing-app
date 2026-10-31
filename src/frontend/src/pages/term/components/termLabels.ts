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

/** Item chip wording once a card links to a pickup term or event. */
export const PICKUP_MODE_LABELS: Record<ExchangeMode, string> = {
  GIFT: "Weź",
  SWAP: "Zamienię",
};

/** Mode wording on a participant's item preview row ("Zamiana / Weź na stałe"). */
export const PREVIEW_MODE_LABELS: Record<ListingMode, string> = {
  GIFT: "Weź na stałe",
  SWAP: "Zamiana",
};

/** Soft background plus a readable foreground per exchange mode. */
export const EXCHANGE_MODE_TONE: Record<ExchangeMode, string> = {
  GIFT: "bg-primary-soft text-primary-fg",
  SWAP: "bg-accent-soft text-accent-fg",
};
