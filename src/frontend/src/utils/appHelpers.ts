import type { GroupResponse, GroupVisibility, PaymentStatus } from "../api/groups";
import type { ListingMode } from "../api/itemListingPreferences";
import type { PublicLocationResponse } from "../api/locations";
import type { ReservationType } from "../api/reservations";
import { viewPath, type View } from "../routing/paths";

/* ------------------------------------------------------------------ */
/*  Panel — współdzielone typy, stałe i czyste helpery                  */
/*  (wydzielone z AppPage.tsx — zero zmian zachowania).               */
/* ------------------------------------------------------------------ */

/** Sub-pages of "Konto": they show a back link to it. */
export const ACCOUNT_SUBVIEWS: readonly View[] = [
  "profile",
  "places",
  "family",
  "groups",
  "meetings",
  "items/reserved",
  "wanted",
  "points",
  "organization",
];

/** A "Konto" sub-page or a page under one (`/wanted/<id>/edit`, `/places/new`, `/groups/<id>`). */
export function isAccountSubviewPath(pathname: string): boolean {
  return ACCOUNT_SUBVIEWS.some((view) => {
    const path = viewPath(view);
    return pathname === path || pathname.startsWith(`${path}/`);
  });
}

/** The distances offered around a picked locality, smallest first. */
export const RADII_KM: readonly number[] = [5, 10, 25, 50];

/** `/places/new` opened from a form's place picker: after saving it goes
 * back to `returnTo` and hands the new place to the picker named `picker`
 * (see `PickedLocationState`). */
export function placeCreatePath(returnTo: string, picker: string): string {
  return `${viewPath("places/new")}?${new URLSearchParams({ returnTo, picker })}`;
}

/** Navigation state `/places/new` returns with to the picker's page;
 * `locationId` is `null` when the user cancelled instead of saving. */
export interface PickedLocationState {
  pickedLocation: { picker: string; locationId: string | null };
}

/** A new group starts PRIVATE until its founder has an Organization page to
 * show it on, PUBLIC afterwards. */
export function defaultVisibility(organizationSlug: string | null): GroupVisibility {
  return organizationSlug === null ? "PRIVATE" : "PUBLIC";
}

export type ModalKind =
  | "pierwszy-termin"
  | null;

/** A person added on `/family/members/new`; `birthYear` only for a CHILD. */
export interface NewFamilyMember {
  name: string;
  roleType: "GUARDIAN" | "CHILD";
  birthYear: number | null;
}

export type ItemMode = "oddam" | "zamienię";

/** A term the caller takes part in without leading it — their own RSVP
 * ("attended") or a term of a circle their family belongs to ("member"). */
export interface GuestTermCard {
  termId: string;
  /** The caller's own RSVP (withdrawable from "Moje zajęcia"); `null` for a membership-only card. */
  attendanceId: string | null;
  occursOn: string;
  groupName: string;
  description: string | null;
  href: string;
  location: TermPlaceLocation | null;
  capacity: number | null;
  /** Known only for an RSVP; a membership-only card shows the capacity alone. */
  attendeeCount: number | null;
  /** Decimal string (`"25.50"`); `null` for a free term. */
  price: string | null;
  /** The caller's own payment — known only for an RSVP. */
  paymentStatus: PaymentStatus | null;
}

export type TermPlaceLocation = Pick<PublicLocationResponse, "locality" | "label" | "formatted_address" | "google_place_id">;

export const ITEM_MODES: ItemMode[] = ["oddam", "zamienię"];

/** Soft tile + readable text per item mode, matching the exchange tones. */
export const ITEM_MODE_TONE: Record<ItemMode, string> = {
  "oddam": "bg-primary-soft text-primary-fg",
  "zamienię": "bg-accent-soft text-accent-fg",
};

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

const MAX_PRICE_CENTS = 100_000_00;
export const MAX_PAYMENT_URL_LENGTH = 500;

export const PRICE_ERROR = "Podaj kwotę od 0,01 do 100 000 zł albo zostaw puste.";
export const PAYMENT_URL_ERROR = "Link musi zaczynać się od https://";
export const PAYMENT_URL_LENGTH_ERROR = "Link do płatności może mieć najwyżej 500 znaków.";
export const PAYMENT_URL_REQUIRES_PRICE_ERROR = "Link wymaga ceny — wpisz cenę albo usuń link.";

/** The raw text of a price input: blank is `null` (free); an amount of
 * 0,01–100 000 zł with at most 2 decimals, a comma or a dot, and spaces
 * allowed as thousand separators ("1 000,50") is its canonical decimal string
 * — the form the server stores and returns (`"1000.50"`), built from the
 * digits, never through a float; anything else is `undefined` (the form shows
 * `PRICE_ERROR` and blocks submit). */
export function parsePrice(raw: string): string | null | undefined {
  const compact = raw.replace(/\s/g, ""); // `\s` covers NBSP too
  if (compact === "") return null;
  const match = /^(\d{1,6})(?:[.,](\d{1,2}))?$/.exec(compact);
  if (!match) return undefined;
  const whole = match[1].replace(/^0+/, "") || "0";
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const cents = Number(whole) * 100 + Number(fraction);
  return cents > 0 && cents <= MAX_PRICE_CENTS ? `${whole}.${fraction}` : undefined;
}

/** The input text for a stored price (`"25.50"` → `"25,50"`). */
export function priceText(price: string | null | undefined): string {
  return price == null ? "" : price.replace(".", ",");
}

const PRICE_FORMAT = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" });

/** A stored price for display: `"25.50"` → "25,50 zł". */
export function formatPrice(price: string): string {
  return PRICE_FORMAT.format(Number(price));
}

/** The raw text of a payment-link input: blank is `null`; a URL starting with
 * a literal `https://` (any case), with a host, no userinfo (no `@` in the
 * authority), no backslash, no whitespace, no Unicode control/format
 * characters (`\p{C}`) and at most 500 characters is returned trimmed but
 * otherwise exactly as typed (never `URL.href`, which would add a trailing
 * slash the server does not store); anything else is `undefined`. Mirrors the
 * server-side check, so the client never accepts a link the API rejects
 * (`https:host`, `https:\host`, U+200B, `user@host`, `https://@host`). */
export function parsePaymentUrl(raw: string): string | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (trimmed.length > MAX_PAYMENT_URL_LENGTH) return undefined;
  if (!/^https:\/\//i.test(trimmed)) return undefined;
  if (/[\s\p{C}\\]/u.test(trimmed)) return undefined;
  // Any `@` in the raw authority (`https://@x.pl`, `https://:@x.pl`) is
  // userinfo to the server, even when WHATWG parses it as empty.
  if (/^https:\/\/[^/?#]*@/i.test(trimmed)) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.hostname === "") return undefined;
  if (url.username !== "" || url.password !== "") return undefined;
  return trimmed;
}

/** The submit gate of every price + link form: both parts valid and no link
 * without a price, else `undefined`. */
export function parsePayment(
  priceRaw: string,
  urlRaw: string,
): { price: string | null; payment_url: string | null } | undefined {
  const price = parsePrice(priceRaw);
  const paymentUrl = parsePaymentUrl(urlRaw);
  if (price === undefined || paymentUrl === undefined) return undefined;
  if (paymentUrl !== null && price === null) return undefined;
  return { price, payment_url: paymentUrl };
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
  return circleTermPath(group.organizer_slug ?? "krag", group.id, termId);
}

/** Public per-term URL from the ids a term row carries. */
export function circleTermPath(organizerSlug: string, groupId: string, termId: string): string {
  return `/${organizerSlug}/group/${groupId}/term/${termId}`;
}
