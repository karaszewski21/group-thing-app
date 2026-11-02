import { normalizeAppPath } from "./paths";

/** State handed to the next page with a navigation (`Link`/`navigate`
 * `state`), kept per target URL until the page reads it once. It lives in
 * memory only, so a reload never shows it again. */
const states = new Map<string, unknown>();

function urlKey(url: string): string {
  const { pathname, search } = new URL(url, "http://app.invalid");
  return normalizeAppPath(pathname) + search;
}

export function setNavigationState(url: string, state: unknown): void {
  if (state === undefined || state === null) states.delete(urlKey(url));
  else states.set(urlKey(url), state);
}

export function peekNavigationState(url: string): unknown {
  return states.get(urlKey(url)) ?? null;
}

export function clearNavigationState(url: string): void {
  states.delete(urlKey(url));
}

/** Drops every pending state, as a fresh document load does. */
export function clearAllNavigationStates(): void {
  states.clear();
}
