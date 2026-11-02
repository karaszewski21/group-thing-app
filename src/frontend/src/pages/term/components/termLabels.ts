import type { ExchangeMode } from "../../../api/groups";
import type { ListingMode } from "../../../api/itemListingPreferences";

/** The modes an item listing can offer, in intent-pill order. */
export const LISTABLE_RESERVATION_TYPES: ListingMode[] = ["SWAP", "GIFT"];

/** Exchange directory labels per listing mode (organizer counts and tabs). */
export const EXCHANGE_MODE_LABELS: Record<ExchangeMode, string> = {
  GIFT: "Oddam",
  SWAP: "Zamienię",
};

/** The owner's intent with an item, on tiles and the product page. */
export const INTENT_LABELS: Record<ExchangeMode, string> = {
  GIFT: "Chcę oddać",
  SWAP: "Chcę się zamienić",
};

/** Soft background plus a readable foreground per exchange mode. */
export const EXCHANGE_MODE_TONE: Record<ExchangeMode, string> = {
  GIFT: "bg-primary-soft text-primary-fg",
  SWAP: "bg-accent-soft text-accent-fg",
};
