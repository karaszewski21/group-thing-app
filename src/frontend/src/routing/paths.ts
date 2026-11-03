export type View =
  | "home"
  | "meetings"
  | "groups"
  | "groups/new"
  | "groups/edit"
  | "items"
  | "profile"
  | "settings"
  | "places"
  | "places/new"
  | "places/edit"
  | "family"
  | "family/new"
  | "family/edit"
  | "family/members/new"
  | "family/members/edit"
  | "account"
  | "search"
  | "wanted"
  | "add"
  | "add/product"
  | "add/term"
  | "add/event"
  | "add/hunting"
  | "events/edit"
  | "terms/edit"
  | "groups/details"
  | "terms/attendees"
  | "messages"
  | "messages/thread"
  | "organization";

const VIEW_VALUES: readonly View[] = [
  "home",
  "meetings",
  "groups",
  "groups/new",
  "groups/edit",
  "items",
  "profile",
  "settings",
  "places",
  "places/new",
  "places/edit",
  "family",
  "family/new",
  "family/edit",
  "family/members/new",
  "family/members/edit",
  "account",
  "search",
  "wanted",
  "add",
  "add/product",
  "add/term",
  "add/event",
  "add/hunting",
  "events/edit",
  "terms/edit",
  "groups/details",
  "terms/attendees",
  "messages",
  "messages/thread",
  "organization",
];

function isView(value: string | undefined): value is View {
  return value !== undefined && (VIEW_VALUES as readonly string[]).includes(value);
}

/** The URL of a panel view: `/` for home, `/<view>` otherwise. */
export function viewPath(view: View): string {
  return view === "home" ? "/" : `/${view}`;
}

/** Panel views with an id in their path (`/<section>/:id` or
 * `/<section>/:id/edit`); they have no `viewPath()`, their URLs come from
 * `groupEditPath`/`placeEditPath`/`familyMemberEditPath`/`eventEditPath`/
 * `termEditPath`/`groupDetailsPath`/`termAttendeesPath`/`threadPath`. */
export const ID_PATH_VIEWS = [
  "groups/edit",
  "places/edit",
  "family/members/edit",
  "events/edit",
  "terms/edit",
  "groups/details",
  "terms/attendees",
  "messages/thread",
] as const satisfies readonly View[];

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

const EDIT_PATH = /^\/(groups|places|family\/members|events|terms)\/[^/]+\/edit$/;
const DETAIL_PATH = /^\/(groups|terms|messages)\/[^/]+$/;
const DETAIL_VIEW = { groups: "groups/details", terms: "terms/attendees", messages: "messages/thread" } as const;

/** The panel view a pathname shows, or `null` when it is not a panel view. */
export function viewFromPath(pathname: string): View | null {
  if (pathname === "/") return "home";
  const edit = EDIT_PATH.exec(pathname);
  if (edit) return `${edit[1] as "groups" | "places" | "family/members" | "events" | "terms"}/edit`;
  const segment = pathname.slice(1);
  if (segment !== "home" && isView(segment) && !(ID_PATH_VIEWS as readonly string[]).includes(segment)) {
    return segment;
  }
  const detail = DETAIL_PATH.exec(pathname);
  return detail ? DETAIL_VIEW[detail[1] as keyof typeof DETAIL_VIEW] : null;
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
  "/settings",
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
