import type {
  MeetingLink,
  OrganizationGroup,
  OrganizationLayoutResponse,
  OrganizationStats,
} from "../api/organizations";
import type { OwnerItemCard, OwnerNearestDate } from "../api/ownerItems";

/** Typed fixtures for `OrganizationLayoutResponse`, shared by the
 * organization page tests so DTO drift breaks `tsc`. */

export function layoutStats(overrides: Partial<OrganizationStats> = {}): OrganizationStats {
  return { group_count: 0, item_count: 0, meeting_count: 0, ...overrides };
}

export function layoutDate(id: string, startsAt: string, overrides: Partial<OwnerNearestDate> = {}): OwnerNearestDate {
  return {
    kind: "TERM",
    id,
    name: `Zajęcia ${id}`,
    starts_at: startsAt,
    location_name: null,
    attendee_count: 0,
    path: `/nutki/group/g1/term/${id}`,
    ...overrides,
  };
}

export function layoutItem(id: string, overrides: Partial<OwnerItemCard> = {}): OwnerItemCard {
  return {
    item_id: id,
    product_name: `Rzecz ${id}`,
    condition: "GOOD",
    mode: "GIFT",
    thumb_url: null,
    added_at: "2026-10-01T12:00:00",
    reservation: null,
    ...overrides,
  };
}

export function layoutGroup(id: string, overrides: Partial<OrganizationGroup> = {}): OrganizationGroup {
  return {
    id,
    name: `Grupa ${id}`,
    layout_mode: "CIRCLE",
    next_term: null,
    upcoming_term_count: 0,
    ...overrides,
  };
}

export function meetingLink(path: string, startsAt: string, kind: MeetingLink["kind"] = "TERM"): MeetingLink {
  return { kind, starts_at: startsAt, path };
}

type LayoutOf<K extends OrganizationLayoutResponse["layout"]> = Extract<OrganizationLayoutResponse, { layout: K }>;

export function classicLayout(overrides: Partial<Omit<LayoutOf<"CLASSIC">, "layout">> = {}): LayoutOf<"CLASSIC"> {
  return { layout: "CLASSIC", stats: layoutStats(), upcoming_terms: [], items: [], ...overrides };
}

export function linksLayout(overrides: Partial<Omit<LayoutOf<"LINKS">, "layout">> = {}): LayoutOf<"LINKS"> {
  return { layout: "LINKS", stats: layoutStats(), ...overrides };
}

export function scheduleLayout(overrides: Partial<Omit<LayoutOf<"SCHEDULE">, "layout">> = {}): LayoutOf<"SCHEDULE"> {
  return {
    layout: "SCHEDULE",
    stats: layoutStats(),
    upcoming_terms: [],
    groups: [],
    item_stats: { GIFT: 0, SWAP: 0 },
    ...overrides,
  };
}

export function exchangeLayout(overrides: Partial<Omit<LayoutOf<"EXCHANGE">, "layout">> = {}): LayoutOf<"EXCHANGE"> {
  return { layout: "EXCHANGE", stats: layoutStats(), items: [], term_links: [], ...overrides };
}
