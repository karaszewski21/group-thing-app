import { useEffect, useRef, useState } from "react";

/** A ref callback for a sentinel element: `onLoadMore` runs whenever it
 * scrolls within 200px of the viewport while `enabled`. Re-enabling after a
 * page has loaded observes again, so a sentinel that is still visible asks
 * for the next page right away. Does nothing without `IntersectionObserver`. */
export function useLoadMoreOnScroll(
  onLoadMore: () => void,
  enabled: boolean,
): (node: HTMLElement | null) => void {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const latest = useRef(onLoadMore);
  useEffect(() => {
    latest.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    if (!node || !enabled || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) latest.current();
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, enabled]);

  return setNode;
}
