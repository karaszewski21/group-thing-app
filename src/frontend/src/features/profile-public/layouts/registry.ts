import type { LayoutOption } from "../../editor/LayoutTab";

/** A person's public profile layout. Keys must stay in sync with
 * PROFILE_PAGE_LAYOUT_KEYS in src/backend/app/users/profile_layouts.py
 * (enforced by organizerKeyParity.test.ts). */
export type ProfileLayoutKey = "BANNER";

export interface ProfileLayoutDefinition extends LayoutOption {
  key: ProfileLayoutKey;
}

export const PROFILE_LAYOUT_REGISTRY: Record<ProfileLayoutKey, ProfileLayoutDefinition> = {
  BANNER: {
    key: "BANNER",
    label: "Baner",
    description: "Baner z awatarem, galeria, najbliższe okazje i rzeczy.",
    thumbnail: { src: "/assets/layouts/profile-banner.svg", alt: "Szkic układu Baner" },
  },
};

export const FALLBACK_PROFILE_LAYOUT = PROFILE_LAYOUT_REGISTRY.BANNER;

/** The layout for a stored key; unknown keys fall back to `BANNER`. */
export function resolveProfileLayout(key: string | null | undefined): ProfileLayoutDefinition {
  return PROFILE_LAYOUT_REGISTRY[key as ProfileLayoutKey] ?? FALLBACK_PROFILE_LAYOUT;
}
