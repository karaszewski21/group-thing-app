import type { OrganizationStats, PageLayoutKey } from "../../../api/organizations";
import type { DirectoryStatus, PageLayoutDefinition } from "./types";

// Served from `public/` at the site root.
const classicThumbnail = "/assets/layouts/classic.svg";
const linksThumbnail = "/assets/layouts/links.svg";
const scheduleThumbnail = "/assets/layouts/schedule.svg";
const exchangeThumbnail = "/assets/layouts/exchange.svg";

const SCHEDULE_MIN_MEETINGS = 3;
const EXCHANGE_MIN_ITEMS = 4;
const EXCHANGE_MAX_MEETINGS = 1;

/** Public organization page layouts: a balanced default, a link card, one
 * for organizers who mostly run terms and events, and one for organizers
 * with many items and few meetings. Each block reads only the props the
 * backend sends for its layout (`OrganizationLayoutResponse`), so a block
 * placed in a layout must be one whose data that layout's response carries.
 * Keys must stay in sync with PAGE_LAYOUT_KEYS in
 * src/backend/app/organizations/page_layouts.py (enforced by
 * organizerKeyParity.test.ts). */
export const LAYOUT_REGISTRY: Record<PageLayoutKey, PageLayoutDefinition> = {
  CLASSIC: {
    key: "CLASSIC",
    label: "Klasyczny",
    description: "Opis, najbliższe spotkania i ostatnie rzeczy.",
    thumbnail: { src: classicThumbnail, alt: "Szkic układu Klasyczny" },
    frame: "column",
    blocks: [
      { block: "hero", variant: "cover" },
      { block: "share" },
      { block: "stats" },
      { block: "about" },
      { block: "gallery", variant: "grid" },
      { block: "upcoming-dates", variant: "list", primary: true },
      { block: "recent-items" },
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
    recommendWhen: (stats) => stats === null || (stats.meeting_count === 0 && stats.item_count === 0),
  },
  SCHEDULE: {
    key: "SCHEDULE",
    label: "Spotkania",
    description: "Gdy często organizujesz zajęcia i wydarzenia.",
    thumbnail: { src: scheduleThumbnail, alt: "Szkic układu Spotkania" },
    frame: "column",
    blocks: [
      { block: "hero", variant: "compact" },
      { block: "stats" },
      { block: "next-date-cta", variant: "card", primary: true },
      { block: "upcoming-dates", variant: "after-next" },
      { block: "groups-grid", variant: "cards", when: { minGroups: 2 } },
      { block: "groups-grid", variant: "featured", when: { maxGroups: 1 } },
      { block: "item-stats" },
      { block: "about" },
      { block: "gallery", variant: "grid" },
      { block: "footer" },
    ],
    recommendWhen: (stats) => (stats?.meeting_count ?? 0) >= SCHEDULE_MIN_MEETINGS,
  },
  EXCHANGE: {
    key: "EXCHANGE",
    label: "Rzeczy",
    description: "Gdy masz dużo rzeczy, a spotkań mało.",
    thumbnail: { src: exchangeThumbnail, alt: "Szkic układu Rzeczy" },
    frame: "column",
    blocks: [
      { block: "hero", variant: "compact" },
      { block: "stats" },
      { block: "recent-items", variant: "featured", primary: true },
      { block: "meeting-links" },
      { block: "about" },
      { block: "gallery", variant: "grid" },
      { block: "footer" },
    ],
    recommendWhen: (stats) =>
      stats !== null && stats.item_count >= EXCHANGE_MIN_ITEMS && stats.meeting_count <= EXCHANGE_MAX_MEETINGS,
  },
};

export const FALLBACK_LAYOUT: PageLayoutKey = "CLASSIC";

/** The effective layout for a stored key; mirrors the backend's
 * `resolve_page_layout` (unknown keys degrade to CLASSIC). */
export function resolveLayout(key?: string | null): PageLayoutDefinition {
  return key != null && Object.hasOwn(LAYOUT_REGISTRY, key)
    ? LAYOUT_REGISTRY[key as PageLayoutKey]
    : LAYOUT_REGISTRY[FALLBACK_LAYOUT];
}

/** Whether the editor shows the "Polecany" badge: never while the stats
 * load, so badges do not flicker in once they arrive. */
export function isRecommended(
  layout: PageLayoutDefinition,
  stats: OrganizationStats | null,
  status: DirectoryStatus,
): boolean {
  if (status === "loading") return false;
  return layout.recommendWhen?.(status === "ready" ? stats : null) ?? false;
}
