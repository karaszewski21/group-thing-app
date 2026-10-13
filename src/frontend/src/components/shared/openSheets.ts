import { useEffect } from "react";

/** Count of page-level dialogs currently open. App-wide prompts read it via
 * `useSyncExternalStore(subscribeOpenSheets, getOpenSheetCount)` and wait
 * until it drops to 0, so they never stack on top of a page dialog. */
let openSheetCount = 0;
const listeners = new Set<() => void>();

function setOpenSheetCount(next: number) {
  openSheetCount = next;
  listeners.forEach((listener) => listener());
}

export function subscribeOpenSheets(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getOpenSheetCount(): number {
  return openSheetCount;
}

/** Counts the calling dialog as open while `open` is true and it is mounted. */
export function useRegisterOpenSheet(open: boolean) {
  useEffect(() => {
    if (!open) return;
    setOpenSheetCount(openSheetCount + 1);
    return () => setOpenSheetCount(openSheetCount - 1);
  }, [open]);
}
