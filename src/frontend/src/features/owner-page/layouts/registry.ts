import dayjs from "../../../utils/dayjs";
import type { OrganizerPageData, PageLayoutDefinition } from "./types";

// Served from `public/` at the site root.
const classicThumbnail = "/assets/layouts/classic.svg";
const linksThumbnail = "/assets/layouts/links.svg";
const scheduleThumbnail = "/assets/layouts/schedule.svg";
const exchangeThumbnail = "/assets/layouts/exchange.svg";

const SCHEDULE_MIN_DATES = 3;
const SCHEDULE_HORIZON_DAYS = 14;
const EXCHANGE_MIN_ITEMS = 4;
const EXCHANGE_MAX_DATES = 1;

function datesWithinHorizon(data: OrganizerPageData): number {
  const horizon = dayjs().add(SCHEDULE_HORIZON_DAYS, "day");
  return data.directory?.upcoming_dates.filter((date) => dayjs(date.starts_at).isBefore(horizon)).length ?? 0;
}

/** Public organization page layouts: a balanced default, a link card, one
 * for organizers who mostly run terms and events, and one for organizers
 * with many items and few meetings. Keys must stay in sync with
 * PAGE_LAYOUT_KEYS in src/backend/app/organizations/page_layouts.py
 * (enforced by organizerKeyParity.test.ts). */
export const LAYOUT_REGISTRY: Record<string, PageLayoutDefinition> = {
  CLASSIC: {
    key: "CLASSIC",
    label: "Klasyczny",
    description: "Opis, najbliższe spotkania i rzeczy.",
    thumbnail: { src: classicThumbnail, alt: "Szkic układu Klasyczny" },
    frame: "column",
    blocks: [
      { block: "hero", variant: "cover" },
      { block: "share" },
      { block: "stats" },
      { block: "about" },
      { block: "gallery", variant: "grid" },
      { block: "upcoming-dates", variant: "list", primary: true },
      { block: "exchange-counts", variant: "tiles3" },
      { block: "footer" },
    ],
  },
  LINKS: {
    key: "LINKS",
    label: "Wizytówka",
    description: "Same linki, jak w bio na Instagramie.",
    thumbnail: { src: linksThumbnail, alt: "Szkic układu Wizytówka" },
    frame: "centered",
    blocks: [
      { block: "hero", variant: "centered" },
      { block: "link-stack", primary: true },
      { block: "about", variant: "on-primary" },
      { block: "gallery", variant: "on-primary" },
      { block: "footer", variant: "on-primary" },
    ],
    recommendWhen: (data) =>
      data.directoryStatus === "unavailable" ||
      (data.directory?.upcoming_dates.length === 0 && data.directory.recent_items.length === 0),
  },
  SCHEDULE: {
    key: "SCHEDULE",
    label: "Spotkania",
    description: "Gdy często organizujesz zajęcia i wydarzenia.",
    thumbnail: { src: scheduleThumbnail, alt: "Szkic układu Spotkania" },
    frame: "column",
    blocks: [
      { block: "hero", variant: "compact" },
      { block: "next-date-cta", variant: "card", primary: true },
      { block: "upcoming-dates", variant: "after-next" },
      { block: "circles-grid", variant: "cards", when: { minCircles: 2 } },
      { block: "circles-grid", variant: "featured", when: { maxCircles: 1 } },
      { block: "about" },
      { block: "gallery", variant: "grid" },
      { block: "exchange-counts", variant: "tiles3" },
      { block: "footer" },
    ],
    recommendWhen: (data) => datesWithinHorizon(data) >= SCHEDULE_MIN_DATES,
  },
  EXCHANGE: {
    key: "EXCHANGE",
    label: "Rzeczy",
    description: "Gdy masz dużo rzeczy, a spotkań mało.",
    thumbnail: { src: exchangeThumbnail, alt: "Szkic układu Rzeczy" },
    frame: "column",
    blocks: [
      { block: "hero", variant: "compact" },
      { block: "recent-items", variant: "featured", primary: true },
      { block: "exchange-board", variant: "grid2" },
      { block: "needed-items", variant: "list" },
      { block: "upcoming-dates", variant: "compact" },
      { block: "about" },
      { block: "gallery", variant: "grid" },
      { block: "footer" },
    ],
    recommendWhen: (data) =>
      (data.directory?.recent_items.length ?? 0) >= EXCHANGE_MIN_ITEMS &&
      (data.directory?.upcoming_dates.length ?? 0) <= EXCHANGE_MAX_DATES,
  },
};

export const FALLBACK_LAYOUT = "CLASSIC";

/** The effective layout for a stored key; mirrors the backend's
 * `resolve_page_layout` (unknown keys degrade to CLASSIC). */
export function resolveLayout(key?: string | null): PageLayoutDefinition {
  return key != null && Object.hasOwn(LAYOUT_REGISTRY, key) ? LAYOUT_REGISTRY[key] : LAYOUT_REGISTRY[FALLBACK_LAYOUT];
}

/** Whether the editor shows the "Polecany" badge: never while the directory
 * loads, so badges do not flicker in once it arrives. */
export function isRecommended(layout: PageLayoutDefinition, data: OrganizerPageData): boolean {
  if (data.directoryStatus === "loading") return false;
  return layout.recommendWhen?.(data) ?? false;
}
