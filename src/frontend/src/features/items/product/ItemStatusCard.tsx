import { Link } from "react-router-dom";
import type { ItemStatusResponse } from "../../../api/items";
import { AddToCalendarButton } from "../../../components/shared/AddToCalendarButton";
import { useOrigin } from "../../../lib/useClientValue";
import { calendarUid, type CalendarEvent } from "../../../utils/calendar";
import { eventPath } from "../../../utils/appHelpers";
import dayjs from "../../../utils/dayjs";
import { organizerTermPath } from "../../owner-page/organizerHelpers";

/** Where the hand-over happens: a Term or an event. `contextId` feeds the
 * calendar uid and `path` the link; `groupName` is the event name for an
 * event. */
interface PartyTerm {
  contextId: string;
  path: string;
  isEvent: boolean;
  groupName: string;
  occursOn: string;
}

/** The hand-over context, present only when the viewer is a reservation
 * party (the backend sends these fields to the taker and the giver only). */
function partyTerm(status: ItemStatusResponse): PartyTerm | null {
  const { code, term_id, group_id, group_name, term_occurs_on, event_id, event_slug } = status;
  if ((code !== "RESERVED" && code !== "IN_TRANSIT") || !group_name || !term_occurs_on) return null;
  if (event_id && event_slug) {
    return { contextId: event_id, path: eventPath(event_slug, event_id), isEvent: true, groupName: group_name, occursOn: term_occurs_on };
  }
  if (!term_id || !group_id) return null;
  return {
    contextId: term_id,
    path: organizerTermPath("krag", group_id, term_id),
    isEvent: false,
    groupName: group_name,
    occursOn: term_occurs_on,
  };
}

const PERSONAL_PICKUP_LINE = "Odbiór osobisty — szczegóły ustalacie na czacie.";
const TAKEN_LINE = "Ta rzecz jest zarezerwowana.";

/** The item's reserved badge as the viewer relates to it (from the item
 * actions): a party of the reservation, with both names for the personal
 * pickup line when known, or anyone else. */
export type StatusReservation = { party: true; ownerName: string; reserverName: string | null } | { party: false };

function personalPickupLine(reservation: StatusReservation | null): string {
  if (reservation === null) return PERSONAL_PICKUP_LINE;
  if (!reservation.party) return TAKEN_LINE;
  return reservation.reserverName
    ? `Odbiór osobisty — szczegóły ustalają ${reservation.ownerName} i ${reservation.reserverName} na czacie.`
    : PERSONAL_PICKUP_LINE;
}

/** A personal pickup has no date, so it reads as a plain status with the
 * chat line (and gets no calendar export: `partyTerm` is null without a
 * context). A pending swap proposal leaves the balance AVAILABLE, so while
 * the item is reserved "Dostępna" gives way to "Zarezerwowana"; the owner's
 * unlisted item reads "U Ciebie", since it is not offered to anyone. */
function statusLines(
  status: ItemStatusResponse,
  reservation: StatusReservation | null,
  unlisted: boolean,
): { title: string; detail: string | null; pill: string } {
  if (reservation && status.code === "AVAILABLE") {
    return { title: "Zarezerwowana", detail: reservation.party ? null : TAKEN_LINE, pill: "bg-accent-soft text-ink" };
  }
  const party = partyTerm(status);
  const term = status.term_occurs_on ? dayjs(status.term_occurs_on).format("DD.MM") : null;
  const pickup = party
    ? `odbiór w ${dayjs(party.occursOn).format("ddd DD.MM [o] HH:mm")} · ${party.groupName}`
    : term
      ? `odbiór na terminie ${term}`
      : null;
  const forLabel = status.counterparty_label ? `Dla: ${status.counterparty_label}` : null;
  if (status.personal_pickup && (status.code === "RESERVED" || status.code === "IN_TRANSIT")) {
    return {
      title: status.code === "RESERVED" ? "Zarezerwowana" : "W drodze",
      detail: personalPickupLine(reservation),
      pill: "bg-accent-soft text-ink",
    };
  }
  switch (status.code) {
    case "AVAILABLE":
      if (unlisted) return { title: "U Ciebie", detail: "Niewystawiona do wymiany.", pill: "bg-cream text-ink" };
      return { title: "Dostępna", detail: null, pill: "bg-primary-soft text-primary-fg" };
    case "RESERVED":
      return {
        title: pickup ? `Zarezerwowana — ${pickup}` : "Zarezerwowana",
        detail: forLabel,
        pill: "bg-accent-soft text-ink",
      };
    case "IN_TRANSIT":
      return {
        title: pickup ? `W drodze — ${pickup}` : "W drodze",
        detail: forLabel,
        pill: "bg-accent-soft text-ink",
      };
    case "RETURNING":
      return { title: "W trakcie zwrotu", detail: forLabel, pill: "bg-accent-soft text-ink" };
    case "PROPOSED_SWAP":
      return {
        title: "Zaproponowana do zamiany — czeka na decyzję",
        detail: forLabel,
        pill: "bg-accent-soft text-ink",
      };
    case "LENT":
      return {
        title: status.due_date
          ? `Pożyczona do ${dayjs(status.due_date).format("DD.MM.YYYY")}`
          : "Pożyczona",
        detail: status.counterparty_label ? `U: ${status.counterparty_label}` : null,
        pill: "bg-teal-soft text-ink",
      };
    case "DELETED":
      return { title: "Usunięta", detail: null, pill: "bg-danger-soft text-danger" };
  }
}

function partyCalendarEvent(
  party: PartyTerm,
  itemId: string,
  itemName: string,
  isOwner: boolean,
  origin: string,
): CalendarEvent {
  return {
    uid: calendarUid(party.contextId, itemId),
    title: isOwner ? `Przekazanie: ${itemName}` : `Odbiór: ${itemName}`,
    occursOn: party.occursOn,
    groupName: party.groupName,
    url: origin + party.path,
  };
}

/** "Aktualny status": a card in the status tone with a clock badge. The
 * status is carried by its text, the colour only reinforces it. Labels come
 * from the server (privacy rule). A reservation party also gets the hour,
 * the group and, until the Term has passed, a calendar export; the owner is
 * the giver. `reservation` is `null` until the actions load or while the
 * item is not reserved. */
export function ItemStatusCard({
  status,
  itemId,
  itemName,
  isOwner,
  reservation = null,
  unlisted = false,
}: {
  status: ItemStatusResponse;
  itemId: string;
  itemName: string;
  isOwner: boolean;
  reservation?: StatusReservation | null;
  /** The owner's item has no listing mode: it is not offered to anyone. */
  unlisted?: boolean;
}) {
  const origin = useOrigin();
  const { title, detail, pill } = statusLines(status, reservation, unlisted);
  const party = partyTerm(status);
  const upcoming = party && dayjs(party.occursOn).isAfter(dayjs()) ? party : null;
  return (
    <section className={`mt-5 flex items-start gap-3 rounded-[22px] p-4 ${pill}`} aria-labelledby="item-status-heading">
      <span aria-hidden="true" className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-paper/70">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </span>
      <div className="min-w-0">
        <h3 id="item-status-heading" className="sr-only">
          Aktualny status
        </h3>
        <p role="status" className="text-[15px] font-extrabold wrap-break-word">
          {title}
        </p>
        {detail && <p className="mt-0.5 text-sm">{detail}</p>}
        {party?.isEvent && (
          <p className="mt-1 text-sm">
            <Link
              to={party.path}
              className="font-bold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              Zobacz wydarzenie
            </Link>
          </p>
        )}
        {upcoming && (
          <div className="mt-3 inline-block rounded-full bg-paper/70">
            <AddToCalendarButton
              event={partyCalendarEvent(upcoming, itemId, itemName, isOwner, origin)}
              size="sm"
              direction="down"
            />
          </div>
        )}
      </div>
    </section>
  );
}
