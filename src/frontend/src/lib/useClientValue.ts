import { useSyncExternalStore } from "react";

const subscribeNever = () => () => {};

/** Reads a browser-only value (storage, `window.location`) during render
 * without touching browser globals on the server: `serverValue` while server
 * rendering and hydrating, `read()` in the browser. `read` must return a
 * primitive (or a cached value), since it runs on every render. */
export function useClientValue<T>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(subscribeNever, read, () => serverValue);
}

/** `window.location.origin` in the browser, `""` while server rendering. */
export function useOrigin(): string {
  return useClientValue(() => window.location.origin, "");
}
