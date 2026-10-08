import type { OrganizerTheme } from "../../../api/groups";
import type { OrganizationResponse, UpdateOrganizationRequest } from "../../../api/organizations";
import { findPreset } from "../../../theme/palettePresets";
import { resolveLayout } from "../layouts/registry";

/** What the owner is choosing in the editor: the effective layout key and
 * the three stored theme fields. */
export interface Draft {
  pageLayout: string;
  theme: OrganizerTheme;
}

/** "Mięta (domyślna)": no preset and no colors. */
export const DEFAULT_THEME: OrganizerTheme = { palette_preset: null, primary_color: null, accent_color: null };

export function toDraft(
  organization: Pick<OrganizationResponse, "page_layout" | "palette_preset" | "primary_color" | "accent_color">,
): Draft {
  return {
    pageLayout: resolveLayout(organization.page_layout).key,
    theme: {
      palette_preset: organization.palette_preset,
      primary_color: organization.primary_color,
      accent_color: organization.accent_color,
    },
  };
}

// Stored hex keeps the case it was sent in, so an upper- and a lowercase spelling are the same color.
function sameHex(a: string | null, b: string | null): boolean {
  return a === null || b === null ? a === b : a.toUpperCase() === b.toUpperCase();
}

/** The fields of `current` that differ from `baseline`, ready to PATCH;
 * a cleared field is sent as an explicit `null`. */
export function diffDraft(current: Draft, baseline: Draft): UpdateOrganizationRequest {
  const request: UpdateOrganizationRequest = {};
  if (current.pageLayout !== baseline.pageLayout) request.page_layout = current.pageLayout;
  if (current.theme.palette_preset !== baseline.theme.palette_preset) {
    request.palette_preset = current.theme.palette_preset;
  }
  if (!sameHex(current.theme.primary_color, baseline.theme.primary_color)) {
    request.primary_color = current.theme.primary_color;
  }
  if (!sameHex(current.theme.accent_color, baseline.theme.accent_color)) {
    request.accent_color = current.theme.accent_color;
  }
  return request;
}

export function sameDraft(a: Draft, b: Draft): boolean {
  return Object.keys(diffDraft(a, b)).length === 0;
}

/** Which palette tile a theme corresponds to; an unknown (retired) preset
 * counts as custom colors. */
export function paletteSelection(theme: OrganizerTheme): string {
  if (theme.palette_preset === null && theme.primary_color === null && theme.accent_color === null) {
    return "DEFAULT";
  }
  return findPreset(theme.palette_preset)?.key ?? "CUSTOM";
}
