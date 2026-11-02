import { useMemo, type CSSProperties, type ReactNode } from "react";
import type { OrganizerTheme } from "../api/groups";
import { DEFAULT_THEME_VARS, resolveOrgTheme } from "./orgPalette";
import { useInitialOrganizerTheme } from "./ServerThemeProvider";

interface OrganizerThemeScopeProps {
  theme: (Pick<OrganizerTheme, "primary_color" | "accent_color"> & { palette_preset?: string | null }) | null | undefined;
  children: ReactNode;
}

/** Sets all 13 role colors inline, so everything inside renders in the
 * organizer's preset or palette (or the defaults when there is none). Until
 * the page's own data arrives, the server-fetched theme stands in. */
export function OrganizerThemeScope({ theme: liveTheme, children }: OrganizerThemeScopeProps) {
  const initialTheme = useInitialOrganizerTheme();
  const theme = liveTheme ?? initialTheme;
  const primaryColor = theme?.primary_color;
  const accentColor = theme?.accent_color;
  const palettePreset = theme?.palette_preset;
  const vars = useMemo(
    () =>
      resolveOrgTheme({
        primary_color: primaryColor ?? null,
        accent_color: accentColor ?? null,
        palette_preset: palettePreset ?? null,
      }),
    [primaryColor, accentColor, palettePreset],
  );

  // No className and never transform/filter/perspective/contain/will-change:
  // any of them would make this div the containing block for the
  // position:fixed sheets and toasts rendered inside it.
  return (
    <div data-organizer-theme={vars === DEFAULT_THEME_VARS ? "default" : "custom"} style={vars as CSSProperties}>
      {children}
    </div>
  );
}
