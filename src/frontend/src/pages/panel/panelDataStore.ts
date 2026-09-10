import { createContext, useContext } from "react";
import type { PanelDataContextValue } from "./PanelDataContext";

/* Context object + hook for the Panel state layer. Kept in a hookless `.ts`
 * sibling so `PanelDataContext.tsx` can export *only* its component
 * (`PanelDataProvider`) and stay clean under `react-refresh/only-export-components`. */

export const PanelDataContext = createContext<PanelDataContextValue | null>(null);

export function usePanelData(): PanelDataContextValue {
  const ctx = useContext(PanelDataContext);
  if (!ctx) {
    throw new Error("usePanelData must be used within PanelDataProvider");
  }
  return ctx;
}
