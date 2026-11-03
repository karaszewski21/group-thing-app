/** Every top-level static segment of the route tree (`src/app`). Each one is
 * in the backend's `RESERVED_SLUGS` too, so no Organization slug is ever
 * shadowed by a page; `test/reservedSlugs.test.ts` checks both. */
export const RESERVED_SLUGS: readonly string[] = [
  "login",
  "product",
  "home",
  "meetings",
  "groups",
  "items",
  "profile",
  "settings",
  "places",
  "family",
  "account",
  "search",
  "wanted",
  "add",
  "events",
  "terms",
  "messages",
  "organization",
  "oauth2",
  "admin",
];
