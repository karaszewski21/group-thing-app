import type { GroupResponse, GroupVisibility } from "../api/groups";
import type { ListingMode } from "../api/itemListingPreferences";
import type { ReservationType } from "../api/reservations";
import type { NeededItemResponse, TermResponse } from "../api/terms";

/* ------------------------------------------------------------------ */
/*  Panel — współdzielone typy, stałe i czyste helpery                  */
/*  (wydzielone z AppPage.tsx — zero zmian zachowania).               */
/* ------------------------------------------------------------------ */

export type View =
  | "home"
  | "spotkania"
  | "rzeczy"
  | "profil"
  | "ustawienia"
  | "miejsca"
  | "rodzina"
  | "konto"
  | "szukaj"
  | "szukam"
  | "dodaj"
  | "wydarzenie";

const VIEW_VALUES: readonly View[] = [
  "home",
  "spotkania",
  "rzeczy",
  "profil",
  "ustawienia",
  "miejsca",
  "rodzina",
  "konto",
  "szukaj",
  "szukam",
  "dodaj",
  "wydarzenie",
];

function isView(value: string | undefined): value is View {
  return value !== undefined && (VIEW_VALUES as readonly string[]).includes(value);
}

/** Sub-pages of "Konto": they show a back link to it. */
export const KONTO_SUBVIEWS: readonly View[] = ["profil", "ustawienia", "miejsca", "rodzina", "szukam"];

/** The URL of a panel view: `/` for home, `/<view>` otherwise. */
export function viewPath(view: View): string {
  return view === "home" ? "/" : `/${view}`;
}

/** The panel view a pathname shows, or `null` when it is not a panel view. */
export function viewFromPath(pathname: string): View | null {
  if (pathname === "/") return "home";
  const segment = pathname.slice(1);
  return segment !== "home" && isView(segment) ? segment : null;
}

/** A new group starts PRIVATE until its founder has an Organization page to
 * show it on, PUBLIC afterwards. */
export function defaultVisibility(organizationSlug: string | null): GroupVisibility {
  return organizationSlug === null ? "PRIVATE" : "PUBLIC";
}

export type ModalKind =
  | "grupa"
  | "edit-grupa"
  | "termin"
  | "pierwszy-termin"
  | "zaloz-grupe"
  | "rodzina-nowa"
  | "edit-termin"
  | null;

export type ItemMode = "oddam" | "zamienię";

export interface TermWithNeeded {
  term: TermResponse;
  group: GroupResponse;
  neededItems: NeededItemResponse[];
}

/** A term the caller takes part in without leading it — their own RSVP
 * ("attended") or a term of a circle their family belongs to ("member"). */
export interface GuestTermCard {
  termId: string;
  occursOn: string;
  groupName: string;
  description: string | null;
  href: string;
  location: TermPlaceLocation | null;
  capacity: number | null;
  /** Known only for an RSVP; a membership-only card shows the capacity alone. */
  attendeeCount: number | null;
  neededItems: NeededItemResponse[];
}

export interface TermPlaceLocation {
  name: string;
  formatted_address: string;
  google_place_id: string | null;
  notes: string | null;
}

export const ITEM_MODES: ItemMode[] = ["oddam", "zamienię"];

/** Soft tile + readable text per item mode, matching the exchange tones. */
export const ITEM_MODE_TONE: Record<ItemMode, string> = {
  "oddam": "bg-primary-soft text-primary-fg",
  "zamienię": "bg-accent-soft text-accent-fg",
};

/** How many items may be set to "oddam" at once. Enforced only in the UI. */
export const MAX_GIFT_ITEMS = 10;

export const GIFT_LIMIT_MESSAGE = `Możesz oddawać naraz najwyżej ${MAX_GIFT_ITEMS} rzeczy. Zdejmij „Oddam” z innej rzeczy, żeby dodać nową.`;

/** `ItemMode` <-> backend `ReservationType` — the Panel's "Moje rzeczy"
 * mode toggle persists as a standing `ItemListingPreference.mode`
 * (`/api/item-listing-preferences`), `GIFT` or `SWAP`. */
export const ITEM_MODE_TO_RESERVATION_TYPE: Record<ItemMode, ListingMode> = {
  "oddam": "GIFT",
  "zamienię": "SWAP",
};

export const RESERVATION_TYPE_TO_ITEM_MODE: Partial<Record<ReservationType, ItemMode>> = {
  GIFT: "oddam",
  SWAP: "zamienię",
};

export const ITEM_MODE_STYLE: Record<ItemMode, { bg: string; c: string }> = {
  "oddam": { bg: "var(--color-mint-soft)", c: "#12604D" },
  "zamienię": { bg: "var(--color-lime-soft)", c: "#56701F" },
};

const MAX_CAPACITY = 10_000;

export const CAPACITY_ERROR = "Podaj liczbę od 1 do 10000";

/** The raw text of an "Ile miejsc" input: blank is `null` (no limit), plain
 * digits 1–10000 are that number, anything else (`-`, `e`, `1e3`, `2.5`) is
 * `undefined` (invalid — the form shows `CAPACITY_ERROR` and blocks submit). */
export function parseCapacity(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return parsed >= 1 && parsed <= MAX_CAPACITY ? parsed : undefined;
}

/** The input text for a stored capacity. */
export function capacityText(capacity: number | null | undefined): string {
  return capacity == null ? "" : String(capacity);
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** `occurs_on` is an ISO datetime (`2026-03-12T17:30:00`); older callers may
 * still pass a bare date. Slice to the date part so `new Date()` stays local
 * (no UTC shift) regardless. */
export function dayMonth(iso: string): { day: string; month: string } {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  const day = String(d.getDate());
  const month = d.toLocaleDateString("pl-PL", { month: "short" }).replace(".", "");
  return { day, month };
}

/** `HH:MM` from an ISO datetime, or `""` when there is no time part (bare
 * date, or the midnight sentinel of a pre-time term). */
export function termTime(iso: string): string {
  const t = iso.slice(11, 16);
  return /^\d{2}:\d{2}$/.test(t) && t !== "00:00" ? t : "";
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words[0]?.[0] ?? "?").toUpperCase() + (words[1]?.[0] ?? "").toUpperCase();
}

/** Public per-term URL. `group.organizer_slug` is always set by the backend
 * (the organizer's Organization slug, or a stable `k-<hash>` when they have
 * no Organization) — the `?? "krag"` only guards the `GET /api/groups` list
 * response, which the Panel never uses to build these links. */
export function termPublicPath(group: GroupResponse, termId: string): string {
  return `/${group.organizer_slug ?? "krag"}/grupa/${group.id}/term/${termId}`;
}
