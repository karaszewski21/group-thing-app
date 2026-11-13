import { useCallback, useEffect, useRef, type MouseEvent } from "react";
import { useAppSearch } from "../../routing/navigation";

const STORAGE_KEY = "search-scroll";

interface SavedScroll {
  search: string;
  y: number;
}

function readSaved(): SavedScroll | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    const saved: unknown = raw ? JSON.parse(raw) : null;
    if (
      typeof saved === "object" &&
      saved !== null &&
      "search" in saved &&
      "y" in saved &&
      typeof saved.search === "string" &&
      typeof saved.y === "number"
    ) {
      return { search: saved.search, y: saved.y };
    }
  } catch {
    // Storage blocked or a malformed entry: start at the top.
  }
  return null;
}

/** Keeps the place in the results across a visit to one of them: a click on
 * a link inside the results remembers the window's scroll for this search's
 * URL, and coming back to the same URL scrolls there once `ready` (the
 * cached pages rendered). Only the URL the page was opened with is restored,
 * so a later search never jumps. Returns the results' `onClickCapture`. */
export function useSearchScrollRestore(ready: boolean): (event: MouseEvent<HTMLElement>) => void {
  const search = useAppSearch();
  const pending = useRef<SavedScroll | null | undefined>(undefined);

  useEffect(() => {
    if (pending.current === undefined) {
      const saved = readSaved();
      pending.current = saved?.search === search ? saved : null;
    }
    if (!ready || !pending.current) return;
    window.scrollTo(0, pending.current.y);
    pending.current = null;
  }, [ready, search]);

  return useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (!(event.target instanceof Element) || !event.target.closest("a[href]")) return;
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ search, y: window.scrollY }));
      } catch {
        // Without storage the results simply open at the top.
      }
    },
    [search],
  );
}
