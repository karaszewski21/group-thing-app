import { createContext, useContext } from "react";
import type { AppDataContextValue } from "./AppDataContext";

/* Context object + hook for the Panel state layer. Kept in a hookless `.ts`
 * sibling so `AppDataContext.tsx` can export *only* its component
 * (`AppDataProvider`) and stay clean under `react-refresh/only-export-components`. */

export const AppDataContext = createContext<AppDataContextValue | null>(null);

export function useAppData(): AppDataContextValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) {
    throw new Error("useAppData must be used within AppDataProvider");
  }
  return ctx;
}
