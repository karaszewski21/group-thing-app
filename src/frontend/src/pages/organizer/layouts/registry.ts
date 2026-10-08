import classicThumbnail from "../../../assets/layouts/classic.svg";
import linksThumbnail from "../../../assets/layouts/links.svg";
import type { PageLayoutDefinition } from "./types";

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
      { block: "about", primary: true },
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
      { block: "about" },
      { block: "footer" },
    ],
    // No directory data exists yet, so "no directory → LINKS" always holds.
    recommended: true,
  },
};

export const FALLBACK_LAYOUT = "CLASSIC";

/** The effective layout for a stored key; mirrors the backend's
 * `resolve_page_layout` (unknown keys degrade to CLASSIC). */
export function resolveLayout(key?: string | null): PageLayoutDefinition {
  return key != null && Object.hasOwn(LAYOUT_REGISTRY, key) ? LAYOUT_REGISTRY[key] : LAYOUT_REGISTRY[FALLBACK_LAYOUT];
}
