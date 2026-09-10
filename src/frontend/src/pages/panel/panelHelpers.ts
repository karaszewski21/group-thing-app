import type { GroupResponse } from "../../api/groups";
import type { NeededItemResponse, TermResponse } from "../../api/terms";

/* ------------------------------------------------------------------ */
/*  Panel — współdzielone typy, stałe i czyste helpery                  */
/*  (wydzielone z PanelPage.tsx — zero zmian zachowania).               */
/* ------------------------------------------------------------------ */

export type View =
  | "home"
  | "spotkania"
  | "rzeczy"
  | "podarki"
  | "profil"
  | "ustawienia"
  | "rodzina";

export type ModalKind =
  | "grupa"
  | "termin"
  | "rzecz"
  | "pierwszy-termin"
  | "rodzina-nowa"
  | "edit-termin"
  | null;

export type ItemMode = "wypożyczę" | "oddam" | "zamienię";
export type GiftSource = "pożyczone" | "otrzymane" | "zamienione";

export interface LocalGift {
  id: string;
  name: string;
  from: string;
  source: GiftSource;
}

export interface TermWithNeeded {
  term: TermResponse;
  group: GroupResponse;
  neededItems: NeededItemResponse[];
}

export const ITEM_MODES: ItemMode[] = ["wypożyczę", "oddam", "zamienię"];

export const ITEM_MODE_STYLE: Record<ItemMode, { bg: string; c: string }> = {
  "wypożyczę": { bg: "var(--color-teal-soft)", c: "#245F61" },
  "oddam": { bg: "var(--color-mint-soft)", c: "#12604D" },
  "zamienię": { bg: "var(--color-lime-soft)", c: "#56701F" },
};

export const GIFT_SOURCE_STYLE: Record<GiftSource, { bg: string; c: string }> = {
  "pożyczone": { bg: "var(--color-teal-soft)", c: "#245F61" },
  "otrzymane": { bg: "var(--color-mint-soft)", c: "#12604D" },
  "zamienione": { bg: "var(--color-lime-soft)", c: "#56701F" },
};

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
export function termPublicPath(group: GroupResponse, termId: number): string {
  return `/${group.organizer_slug ?? "krag"}/grupa/${group.id}/term/${termId}`;
}
