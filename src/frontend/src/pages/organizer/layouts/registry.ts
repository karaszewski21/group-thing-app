import circlesThumbnail from "../../../assets/layouts/circles.svg";
import classicThumbnail from "../../../assets/layouts/classic.svg";
import exchangeThumbnail from "../../../assets/layouts/exchange.svg";
import linksThumbnail from "../../../assets/layouts/links.svg";
import scheduleThumbnail from "../../../assets/layouts/schedule.svg";
import dayjs from "../../../utils/dayjs";
import { exchangeTotal } from "../organizerHelpers";
import type { OrganizerPageData, PageLayoutDefinition } from "./types";

const SCHEDULE_MIN_TERMS = 4;
const SCHEDULE_HORIZON_DAYS = 14;
const CIRCLES_MIN_CIRCLES = 2;
const EXCHANGE_MIN_ITEMS = 4;

function termsWithinHorizon(data: OrganizerPageData): number {
  const horizon = dayjs().add(SCHEDULE_HORIZON_DAYS, "day");
  return data.directory?.upcoming_terms.filter((term) => dayjs(term.occurs_on).isBefore(horizon)).length ?? 0;
}

function exchangeItemCount(data: OrganizerPageData): number {
  const counts = data.directory?.exchange.counts;
  return counts ? exchangeTotal(counts) : 0;
}

/** Public organization page layouts. Keys must stay in sync with
 * PAGE_LAYOUT_KEYS in src/backend/app/organizations/page_layouts.py
 * (enforced by organizerKeyParity.test.ts). */
export const LAYOUT_REGISTRY: Record<string, PageLayoutDefinition> = {
  CLASSIC: {
    key: "CLASSIC",
    label: "Klasyczny",
    description: "Profil z opisem i terminami.",
    thumbnail: { src: classicThumbnail, alt: "Szkic układu Klasyczny" },
    frame: "column",
    blocks: [
      { block: "hero", variant: "cover" },
      { block: "share" },
      { block: "stats" },
      { block: "about" },
      { block: "upcoming-terms", variant: "list", primary: true },
      { block: "exchange-counts", variant: "tiles3" },
      { block: "footer" },
    ],
  },
  SCHEDULE: {
    key: "SCHEDULE",
    label: "Plan zajęć",
    description: "Gdy masz wiele zajęć w tygodniu.",
    thumbnail: { src: scheduleThumbnail, alt: "Szkic układu Plan zajęć" },
    frame: "column",
    blocks: [
      { block: "hero", variant: "compact" },
      { block: "next-term-cta", variant: "card" },
      { block: "agenda", variant: "by-day", primary: true },
      { block: "about" },
      { block: "exchange-counts", variant: "tiles3" },
      { block: "footer" },
    ],
    recommendWhen: (data) => termsWithinHorizon(data) >= SCHEDULE_MIN_TERMS,
  },
  CIRCLES: {
    key: "CIRCLES",
    label: "Grupy",
    description: "Twoje grupy na jednej stronie.",
    thumbnail: { src: circlesThumbnail, alt: "Szkic układu Grupy" },
    frame: "column",
    blocks: [
      { block: "hero", variant: "cover" },
      { block: "share" },
      { block: "circles-grid", variant: "cards", primary: true, when: { minCircles: 2 } },
      { block: "circles-grid", variant: "featured", primary: true, when: { maxCircles: 1 } },
      { block: "about" },
      { block: "exchange-counts", variant: "tiles3" },
      { block: "footer" },
    ],
    recommendWhen: (data) => (data.directory?.circles.length ?? 0) >= CIRCLES_MIN_CIRCLES,
  },
  EXCHANGE: {
    key: "EXCHANGE",
    label: "Wymiana",
    description: "Tablica rzeczy do oddania i wymiany.",
    thumbnail: { src: exchangeThumbnail, alt: "Szkic układu Wymiana" },
    frame: "column",
    blocks: [
      { block: "hero", variant: "compact" },
      { block: "exchange-board", variant: "grid2", primary: true },
      { block: "needed-items", variant: "list" },
      { block: "upcoming-terms", variant: "compact" },
      { block: "about" },
      { block: "footer" },
    ],
    recommendWhen: (data) => exchangeItemCount(data) >= EXCHANGE_MIN_ITEMS,
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
      { block: "about" },
      { block: "footer" },
    ],
    recommendWhen: (data) => data.directoryStatus === "unavailable" || data.directory?.circles.length === 0,
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
