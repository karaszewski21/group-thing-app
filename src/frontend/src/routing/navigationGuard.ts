import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeAppPath } from "./paths";

/** Where a navigation goes; `pathname: null` when the document itself is
 * left (reload, closed tab, another site). */
export interface NavigationTarget {
  pathname: string | null;
}

export type NavigationGuardPredicate = (next: NavigationTarget) => boolean;

/** Shaped like React Router's `useBlocker` result. */
export interface NavigationBlocker {
  state: "unblocked" | "blocked";
  /** Lets the blocked navigation through. */
  proceed: () => void;
  /** Drops the blocked navigation and stays. */
  reset: () => void;
}

interface HistoryEntry {
  url: string;
  state: unknown;
}

interface Guard {
  shouldBlock: NavigationGuardPredicate;
  block: (proceed: () => void) => void;
  entry: () => HistoryEntry;
}

const guards = new Set<Guard>();
let unguarded = false;
let passNextPop = false;

function blockingGuard(target: NavigationTarget): Guard | undefined {
  if (unguarded) return undefined;
  for (const guard of guards) if (guard.shouldBlock(target)) return guard;
  return undefined;
}

function runUnguarded(navigate: () => void) {
  unguarded = true;
  try {
    navigate();
  } finally {
    unguarded = false;
  }
}

/** Asks the active guards first; `true` when one of them holds the
 * navigation back (it calls `proceed` once the user lets it through). */
export function interceptNavigation(target: NavigationTarget, proceed: () => void): boolean {
  const guard = blockingGuard(target);
  if (!guard) return false;
  guard.block(() => runUnguarded(proceed));
  return true;
}

function sameOriginAnchor(event: MouseEvent): HTMLAnchorElement | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return null;
  return anchor.origin === window.location.origin ? anchor : null;
}

// Capture phase on the document: runs before the router's own link handler.
function onDocumentClick(event: MouseEvent) {
  const anchor = sameOriginAnchor(event);
  if (!anchor) return;
  const guard = blockingGuard({ pathname: normalizeAppPath(anchor.pathname) });
  if (!guard) return;
  event.preventDefault();
  event.stopPropagation();
  guard.block(() => {
    if (anchor.isConnected) runUnguarded(() => anchor.click());
    else window.location.assign(anchor.href);
  });
}

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (blockingGuard({ pathname: null })) event.preventDefault();
}

// Back/forward, best effort: the URL has already changed when popstate
// fires, so a blocked step puts the guarded page's URL back and `proceed`
// steps back to where the user was going. Registered at module load, before
// the router's own listener, so a blocked step never reaches the router.
function onPopState(event: PopStateEvent) {
  if (passNextPop) {
    passNextPop = false;
    return;
  }
  const guard = blockingGuard({ pathname: normalizeAppPath(window.location.pathname) });
  if (!guard) return;
  event.stopImmediatePropagation();
  const { url, state } = guard.entry();
  window.history.pushState(state, "", url);
  guard.block(() => {
    passNextPop = true;
    window.history.back();
  });
}

if (typeof window !== "undefined") window.addEventListener("popstate", onPopState);

function registerGuard(guard: Guard): () => void {
  if (guards.size === 0) {
    document.addEventListener("click", onDocumentClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);
  }
  guards.add(guard);
  return () => {
    guards.delete(guard);
    if (guards.size === 0) {
      document.removeEventListener("click", onDocumentClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    }
  };
}

function currentEntry(): HistoryEntry {
  const { pathname, search, hash } = window.location;
  return { url: pathname + search + hash, state: window.history.state };
}

/** Holds back in-app link clicks, facade navigations, back/forward (best
 * effort) and leaving the document while `shouldBlock` says so. */
export function useNavigationGuard(shouldBlock: NavigationGuardPredicate): NavigationBlocker {
  const [pending, setPending] = useState<{ proceed: () => void } | null>(null);
  const latest = useRef<{ shouldBlock: NavigationGuardPredicate; entry: HistoryEntry | null }>({
    shouldBlock,
    entry: null,
  });

  useEffect(() => {
    latest.current = { shouldBlock, entry: currentEntry() };
  });

  useEffect(
    () =>
      registerGuard({
        shouldBlock: (target) => latest.current.shouldBlock(target),
        block: (proceed) => setPending({ proceed }),
        entry: () => latest.current.entry ?? currentEntry(),
      }),
    [],
  );

  return useMemo(
    () => ({
      state: pending ? "blocked" : "unblocked",
      proceed: () => {
        setPending(null);
        pending?.proceed();
      },
      reset: () => setPending(null),
    }),
    [pending],
  );
}
