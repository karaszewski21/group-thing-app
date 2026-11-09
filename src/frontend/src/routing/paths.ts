/** The panel sections with a fixed URL; `viewPath()` builds it. Sections
 * with an id in the path have their own builders below. */
export type View =
  | "home"
  | "meetings"
  | "groups"
  | "groups/new"
  | "items"
  | "items/reserved"
  | "profile"
  | "places"
  | "places/new"
  | "family"
  | "family/new"
  | "family/edit"
  | "family/members/new"
  | "account"
  | "search"
  | "wanted"
  | "add"
  | "add/product"
  | "add/term"
  | "add/event"
  | "add/hunting"
  | "messages"
  | "organization"
  | "organization/appearance";

/** The URL of a panel view: `/` for home, `/<view>` otherwise. */
export function viewPath(view: View): string {
  return view === "home" ? "/" : `/${view}`;
}

export function groupDetailsPath(groupId: string): string {
  return `/groups/${groupId}`;
}

export function termAttendeesPath(termId: string): string {
  return `/terms/${termId}`;
}

export function groupEditPath(groupId: string): string {
  return `/groups/${groupId}/edit`;
}

export function placeEditPath(locationId: string): string {
  return `/places/${locationId}/edit`;
}

const PARTY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A UUID-shaped first path segment is a party id (a person), never an
 * Organization slug: the backend keeps slugs from looking like UUIDs. */
export function isPartyId(segment: string): boolean {
  return PARTY_ID.test(segment);
}

/** An owner's public page: their Organization's, else their person profile. */
export function ownerPagePath(owner: { slug: string | null; party_id: string }): string {
  return `/${owner.slug ?? owner.party_id}`;
}

/** The public event page, under the author's organizer slug (`EventResponse.author_slug`). */
export function eventPath(organizerSlug: string, eventId: string): string {
  return `/${organizerSlug}/event/${eventId}`;
}

export function eventEditPath(eventId: string): string {
  return `/events/${eventId}/edit`;
}

export function termEditPath(termId: string): string {
  return `/terms/${termId}/edit`;
}

export function familyMemberEditPath(familyMembershipId: string): string {
  return `/family/members/${familyMembershipId}/edit`;
}

/** The URL the app works with: the `/home` rewrite target of `/` (for
 * session holders) reads as `/`, every other pathname is unchanged. */
export function normalizeAppPath(pathname: string): string {
  return pathname === "/home" ? "/" : pathname;
}

export interface PathMatch {
  params: Record<string, string>;
}

/** Matches a route pattern (`/a/:id`, an optional trailing `/*` splat kept as
 * `params["*"]`) against a pathname, segment by segment; a trailing slash
 * on the pathname is ignored. */
export function matchPath(pattern: string, pathname: string): PathMatch | null {
  const patternSegments = pattern.split("/").filter(Boolean);
  const pathSegments = pathname.split("/").filter(Boolean);
  const splat = patternSegments.at(-1) === "*";
  if (splat) patternSegments.pop();
  if (splat ? pathSegments.length < patternSegments.length : pathSegments.length !== patternSegments.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (const [i, segment] of patternSegments.entries()) {
    const value = decodeURIComponent(pathSegments[i]);
    if (segment.startsWith(":")) params[segment.slice(1)] = value;
    else if (segment !== value) return null;
  }
  if (splat) params["*"] = pathSegments.slice(patternSegments.length).map(decodeURIComponent).join("/");
  return { params };
}

/** Path prefixes that need a session; each matches on a segment boundary
 * (`/add/` with its slash, so `/add` itself stays public). */
export const PROTECTED_PREFIXES: readonly string[] = [
  "/home",
  "/meetings",
  "/groups",
  "/items",
  "/profile",
  "/places",
  "/family",
  "/account",
  "/search",
  "/wanted",
  "/add/",
  "/events/",
  "/terms/",
  "/messages",
  "/organization",
  "/oauth2/authorize",
  "/admin",
];
