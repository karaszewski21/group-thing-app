import type { ReactNode } from "react";
import type {
  OrganizationLayoutResponse,
  OrganizationStats,
  PageLayoutKey,
  PublicOrganizationResponse,
} from "../../../api/organizations";

export type BlockId =
  | "hero"
  | "share"
  | "about"
  | "gallery"
  | "link-stack"
  | "footer"
  | "stats"
  | "upcoming-dates"
  | "next-date-cta"
  | "groups-grid"
  | "item-stats"
  | "recent-items"
  | "meeting-links";

/** One block placement in a layout. `variant` is read by the block itself;
 * `primary` marks the layout's main content slot (exactly one is active for
 * any group count). `when` limits the slot to a range of group counts. */
export interface BlockSlot {
  block: BlockId;
  variant?: string;
  primary?: true;
  when?: { minGroups?: number; maxGroups?: number };
}

export type DirectoryStatus = "loading" | "ready" | "unavailable";

/** `directory` is the rendered layout's data from
 * `/public/organizations/{slug}/layout/{key}`, non-null only when
 * `directoryStatus` is `ready`. */
export interface OrganizerPageData {
  organization: PublicOrganizationResponse;
  directory: OrganizationLayoutResponse | null;
  directoryStatus: DirectoryStatus;
}

export interface PageLayoutDefinition {
  key: PageLayoutKey;
  label: string;
  description: string;
  thumbnail: { src: string; alt: string };
  frame: "column" | "centered";
  blocks: BlockSlot[];
  /** Shows the "Polecany" badge on this layout's editor card from the
   * owner's stats (every layout's response has them); read through
   * `isRecommended`, which never recommends while they load. */
  recommendWhen?: (stats: OrganizationStats | null) => boolean;
}

export type RenderMode = "visitor" | "owner-edit";

/** `heroAction` is the owner's settings button, which only the hero places. */
export interface BlockProps {
  data: OrganizerPageData;
  variant?: string;
  mode: RenderMode;
  heroAction?: ReactNode;
}
