import type { WantResponse } from "../../api/wants";
import dayjs from "../../utils/dayjs";
import { pluralPl } from "../../utils/plural";

const OFFER_MODE_LABEL = { GIFT: "Oddam", SWAP: "Zamiana", POINTS: "Za punkty" } as const;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A closed want stays on the list this long before the server removes it. */
const REMOVAL_DAYS = 30;

/** The filter line of a want: category, offer mode and place joined with
 * " · ". `category` picks the node's own name (list) or its full path
 * (match page). */
export function wantSummary(want: WantResponse, category: "name" | "path"): string {
  const categoryLabel = category === "path" ? want.category_path : want.category_name;
  const modeLabel = want.offer_mode && OFFER_MODE_LABEL[want.offer_mode];
  const parts: string[] = [];
  if (categoryLabel || modeLabel || want.locality_name) {
    if (categoryLabel) parts.push(categoryLabel);
    if (modeLabel) parts.push(modeLabel);
    parts.push(placeLabel(want));
  } else {
    parts.push("Bez doprecyzowania");
  }
  if (!want.notifications_enabled) parts.push("powiadomienia wyłączone");
  return parts.join(" · ");
}

function placeLabel(want: WantResponse): string {
  if (!want.locality_name) return "cała Polska";
  return want.radius_km ? `${want.locality_name} +${want.radius_km} km` : want.locality_name;
}

export function matchCountLabel(count: number): string {
  return `${count} ${pluralPl(count, "pasująca rzecz", "pasujące rzeczy", "pasujących rzeczy")}`;
}

export function newCountLabel(count: number): string {
  return `${count} ${pluralPl(count, "nowa", "nowe", "nowych")}`;
}

export function daysLabel(count: number): string {
  return `${count} ${count === 1 ? "dzień" : "dni"}`;
}

/** Days from now to `moment`; a started day counts, 0 once it has passed. */
function daysLeft(moment: dayjs.Dayjs): number {
  return Math.max(0, Math.ceil(moment.diff(dayjs.utc()) / DAY_MS));
}

/** Days left until a naive-UTC server timestamp. */
export function daysUntil(timestamp: string): number {
  return daysLeft(dayjs.utc(timestamp));
}

/** Full days since a naive-UTC server timestamp. */
export function daysSince(timestamp: string): number {
  return Math.max(0, Math.floor(dayjs.utc().diff(dayjs.utc(timestamp)) / DAY_MS));
}

/** How long ago a naive-UTC server timestamp was: "dzisiaj" within the
 * first day, otherwise "N dni temu". */
export function agoLabel(timestamp: string): string {
  const days = daysSince(timestamp);
  return days === 0 ? "dzisiaj" : `${daysLabel(days)} temu`;
}

/** Days until a want closed at `closedAt` disappears from the list. */
export function daysUntilRemoval(closedAt: string): number {
  return daysLeft(dayjs.utc(closedAt).add(REMOVAL_DAYS, "day"));
}
