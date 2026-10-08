import type { PublicOrganizationResponse } from "../../../api/organizations";

export type BlockId = "hero" | "share" | "about" | "link-stack" | "footer";

/** One block placement in a layout. `variant` is read by HeroBlock
 * (`cover` / `centered`); `primary` marks the layout's main content slot
 * (exactly one per layout). */
export interface BlockSlot {
  block: BlockId;
  variant?: string;
  primary?: true;
}

export interface OrganizerPageData {
  organization: PublicOrganizationResponse;
}

export interface PageLayoutDefinition {
  key: string;
  label: string;
  description: string;
  thumbnail: { src: string; alt: string };
  frame: "column" | "centered";
  blocks: BlockSlot[];
  /** Shows the "Polecany" badge on this layout's editor card. */
  recommended?: true;
}

export type RenderMode = "visitor" | "owner-edit";

export interface BlockProps {
  data: OrganizerPageData;
  variant?: string;
}
