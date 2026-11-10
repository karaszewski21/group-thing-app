import type { OrganizerTheme } from "../../api/groups";
import { findPreset } from "../../theme/palettes";

/** What the owner is choosing in the editor: the page's name, its "O nas" /
 * "O mnie" text as typed ("" for none), the effective layout key and the
 * three stored theme fields. */
export interface Draft {
  name: string;
  about: string;
  pageLayout: string;
  theme: OrganizerTheme;
}

/** The fields of a draft that differ from the stored page, as the owner's
 * adapter turns them into its own requests; a cleared field is `null`. */
export interface DraftChanges {
  name?: string;
  about?: string | null;
  page_layout?: string;
  palette_preset?: string | null;
  primary_color?: string | null;
  accent_color?: string | null;
}

/** "Mięta (domyślna)": no preset and no colors. */
export const DEFAULT_THEME: OrganizerTheme = { palette_preset: null, primary_color: null, accent_color: null };

export interface StoredPage {
  name: string;
  about: string | null;
  pageLayout: string;
  palette_preset: string | null;
  primary_color: string | null;
  accent_color: string | null;
}

export function toDraft(page: StoredPage): Draft {
  return {
    name: page.name,
    about: page.about ?? "",
    pageLayout: page.pageLayout,
    theme: {
      palette_preset: page.palette_preset,
      primary_color: page.primary_color,
      accent_color: page.accent_color,
    },
  };
}

// Stored hex keeps the case it was sent in, so an upper- and a lowercase spelling are the same color.
function sameHex(a: string | null, b: string | null): boolean {
  return a === null || b === null ? a === b : a.toUpperCase() === b.toUpperCase();
}

/** The fields of `current` that differ from `baseline`. The server trims
 * the texts, so surrounding whitespace alone is no change. */
export function diffDraft(current: Draft, baseline: Draft): DraftChanges {
  const changes: DraftChanges = {};
  if (current.name.trim() !== baseline.name.trim()) changes.name = current.name.trim();
  if (current.about.trim() !== baseline.about.trim()) changes.about = current.about.trim() || null;
  if (current.pageLayout !== baseline.pageLayout) changes.page_layout = current.pageLayout;
  if (current.theme.palette_preset !== baseline.theme.palette_preset) {
    changes.palette_preset = current.theme.palette_preset;
  }
  if (!sameHex(current.theme.primary_color, baseline.theme.primary_color)) {
    changes.primary_color = current.theme.primary_color;
  }
  if (!sameHex(current.theme.accent_color, baseline.theme.accent_color)) {
    changes.accent_color = current.theme.accent_color;
  }
  return changes;
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
