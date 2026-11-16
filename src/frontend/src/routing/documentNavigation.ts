/** A full page load of `to` in place of the current history entry, leaving
 * the client router and everything it has cached behind. */
export function replaceDocument(to: string): void {
  window.location.replace(to);
}
