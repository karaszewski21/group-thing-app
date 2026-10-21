const FOCUSABLE =
  'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab/Shift+Tab focus cycling inside `container`. Focus on the
 * container itself (as on open) counts as outside its cycle. */
export function trapFocus(
  e: { shiftKey: boolean; preventDefault: () => void },
  container: HTMLElement | null,
) {
  if (!container) return;
  // Filtered rather than `querySelectorAll(FOCUSABLE)`, which jsdom does not
  // return in document order for a selector list with `:not()`.
  const focusable = Array.from(container.querySelectorAll<HTMLElement>("*")).filter((el) => el.matches(FOCUSABLE));
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  const inside = active !== container && container.contains(active);
  if (e.shiftKey && (!inside || active === first)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (!inside || active === last)) {
    e.preventDefault();
    first.focus();
  }
}
