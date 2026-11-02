"use client";

import { createContext, useContext, useMemo, type CSSProperties, type ReactNode } from "react";
import type { OrganizerTheme } from "../api/groups";
import { resolveOrgTheme } from "./orgPalette";

const InitialThemeContext = createContext<OrganizerTheme | null>(null);

/** The theme the server fetched for this page, for an `OrganizerThemeScope`
 * whose own data has not loaded yet. */
// eslint-disable-next-line react-refresh/only-export-components -- the provider and its reader share one private context
export function useInitialOrganizerTheme(): OrganizerTheme | null {
  return useContext(InitialThemeContext);
}

/** Paints the organizer's palette into the first HTML response: the server
 * layout or page passes the theme it fetched, and the vars sit on a
 * `display: contents` wrapper so the box tree is unchanged. */
export function ServerThemeProvider({ initialTheme, children }: { initialTheme: OrganizerTheme; children: ReactNode }) {
  const vars = useMemo(() => resolveOrgTheme(initialTheme), [initialTheme]);
  return (
    <InitialThemeContext.Provider value={initialTheme}>
      <div style={{ ...(vars as CSSProperties), display: "contents" }}>{children}</div>
    </InitialThemeContext.Provider>
  );
}
