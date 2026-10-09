import type { OrganizerPageResponse } from "../../../api/groups";
import type { PublicOrganizationResponse } from "../../../api/organizations";

export type BlockId =
  | "hero"
  | "share"
  | "about"
  | "link-stack"
  | "footer"
  | "stats"
  | "upcoming-terms"
  | "next-term-cta"
  | "agenda"
  | "circles-grid"
  | "exchange-counts"
  | "exchange-board"
  | "needed-items";

/** One block placement in a layout. `variant` is read by the block itself;
 * `primary` marks the layout's main content slot (exactly one is active for
 * any circle count). `when` limits the slot to a range of circle counts. */
export interface BlockSlot {
  block: BlockId;
  variant?: string;
  primary?: true;
  when?: { minCircles?: number; maxCircles?: number };
}

export type DirectoryStatus = "loading" | "ready" | "unavailable";

/** `directory` is non-null only when `directoryStatus` is `ready`. */
export interface OrganizerPageData {
  organization: PublicOrganizationResponse;
  directory: OrganizerPageResponse | null;
  directoryStatus: DirectoryStatus;
}

export interface PageLayoutDefinition {
  key: string;
  label: string;
  description: string;
  thumbnail: { src: string; alt: string };
  frame: "column" | "centered";
  blocks: BlockSlot[];
  /** Shows the "Polecany" badge on this layout's editor card; read through
   * `isRecommended`, which never recommends while the directory loads. */
  recommendWhen?: (data: OrganizerPageData) => boolean;
}

export type RenderMode = "visitor" | "owner-edit";

export interface BlockProps {
  data: OrganizerPageData;
  variant?: string;
  mode: RenderMode;
}
