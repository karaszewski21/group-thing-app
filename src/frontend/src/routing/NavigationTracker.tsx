import { useEffect, useSyncExternalStore } from "react";

export interface NavigationCall {
  method: "push" | "replace" | "back";
  /** `null` for `back`. */
  url: string | null;
  scroll: boolean;
}

/** Client navigations pushed since the document loaded, minus the history
 * steps back (popstate; forward is counted as a step back too — best effort). */
let depth = 0;
const depthListeners = new Set<() => void>();
const callListeners = new Set<(call: NavigationCall) => void>();

function setDepth(next: number) {
  depth = Math.max(0, next);
  for (const listener of depthListeners) listener();
}

function subscribeDepth(listener: () => void) {
  depthListeners.add(listener);
  return () => {
    depthListeners.delete(listener);
  };
}

/** Called by the navigation facade for every navigation it performs. */
export function recordNavigation(call: NavigationCall): void {
  if (call.method === "push") setDepth(depth + 1);
  for (const listener of callListeners) listener(call);
}

export function subscribeNavigationCalls(listener: (call: NavigationCall) => void): () => void {
  callListeners.add(listener);
  return () => {
    callListeners.delete(listener);
  };
}

/** Whether a "back" stays inside the app: false on a page opened directly
 * (a new tab, a shared link, a reload). */
export function useHasInAppHistory(): boolean {
  return useSyncExternalStore(
    subscribeDepth,
    () => depth > 0,
    () => false,
  );
}

/** Mounted once at the app root: starts the count at the document load and
 * lowers it on every history step. */
export function NavigationTracker() {
  useEffect(() => {
    setDepth(0);
    const onPopState = () => setDepth(depth - 1);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  return null;
}
