import type { ItemHistoryEntryResponse, ItemStatusResponse, MovementType } from "../../api/items";
import { AddToCalendarButton } from "../../components/shared/AddToCalendarButton";
import { calendarUid, type CalendarEvent } from "../../utils/calendar";
import dayjs from "../../utils/dayjs";
import { organizerTermPath } from "../organizer/organizerHelpers";

const MOVEMENT_LABELS: Record<MovementType, string> = {
  REGISTER: "Dodana",
  GIFT: "Podarowana",
  LEND: "Pożyczona",
  RETURN: "Zwrócona",
  SWAP: "Zamieniona",
  REMOVE: "Usunięta",
};

const CARD = "mt-4 rounded-3xl border border-line bg-paper p-5";
const CARD_LABEL = "text-[11.5px] font-extrabold uppercase tracking-wide text-ink-soft";

interface PartyTerm {
  termId: string;
  groupId: string;
  groupName: string;
  occursOn: string;
}

/** The hand-over Term, present only when the viewer is a reservation party
 * (the backend sends these fields to the taker and the giver only). */
function partyTerm(status: ItemStatusResponse): PartyTerm | null {
  const { code, term_id, group_id, group_name, term_occurs_on } = status;
  if ((code !== "RESERVED" && code !== "IN_TRANSIT") || !term_id || !group_id || !group_name || !term_occurs_on) return null;
  return { termId: term_id, groupId: group_id, groupName: group_name, occursOn: term_occurs_on };
}

function statusLines(status: ItemStatusResponse): { title: string; detail: string | null; pill: string } {
  const party = partyTerm(status);
  const term = status.term_occurs_on ? dayjs(status.term_occurs_on).format("DD.MM") : null;
  const pickup = party
    ? `odbiór w ${dayjs(party.occursOn).format("ddd DD.MM [o] HH:mm")} · ${party.groupName}`
    : term
      ? `odbiór na terminie ${term}`
      : null;
  const forLabel = status.counterparty_label ? `Dla: ${status.counterparty_label}` : null;
  switch (status.code) {
    case "AVAILABLE":
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

function partyCalendarEvent(party: PartyTerm, itemId: string, itemName: string, isOwner: boolean): CalendarEvent {
  return {
    uid: calendarUid(party.termId, itemId),
    title: isOwner ? `Przekazanie: ${itemName}` : `Odbiór: ${itemName}`,
    occursOn: party.occursOn,
    groupName: party.groupName,
    url: window.location.origin + organizerTermPath("krag", party.groupId, party.termId),
  };
}

/** "Aktualny status": a card in the status tone with a clock badge. The
 * status is carried by its text, the colour only reinforces it. Labels come
 * from the server (privacy rule). A reservation party also gets the hour,
 * the group and, until the Term has passed, a calendar export; the owner is
 * the giver. */
export function ItemStatusCard({
  status,
  itemId,
  itemName,
  isOwner,
}: {
  status: ItemStatusResponse;
  itemId: string;
  itemName: string;
  isOwner: boolean;
}) {
  const { title, detail, pill } = statusLines(status);
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
        {upcoming && (
          <div className="mt-3 inline-block rounded-full bg-paper/70">
            <AddToCalendarButton
              event={partyCalendarEvent(upcoming, itemId, itemName, isOwner)}
              size="sm"
              direction="down"
            />
          </div>
        )}
      </div>
    </section>
  );
}

interface ItemHistoryCardProps {
  entries: ItemHistoryEntryResponse[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

/** "Historia": newest first, as returned by the API. A failure here stays
 * inside this card. */
export function ItemHistoryCard({ entries, loading, error, onRetry }: ItemHistoryCardProps) {
  return (
    <section className={CARD} aria-labelledby="item-history-heading">
      <h3 id="item-history-heading" className={CARD_LABEL}>
        Historia
      </h3>
      <ItemHistoryBody entries={entries} loading={loading} error={error} onRetry={onRetry} />
    </section>
  );
}

function ItemHistoryBody({ entries, loading, error, onRetry }: ItemHistoryCardProps) {
  if (error) {
    return (
      <div className="mt-2.5">
        <p className="text-[12.5px] font-semibold text-danger">
          Nie udało się wczytać historii — spróbuj ponownie
        </p>
        <p className="mt-0.5 text-[11.5px] text-ink-soft">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-xl border border-line bg-paper px-4 py-2 text-[13px] font-semibold text-ink transition-colors hover:bg-cream"
        >
          Spróbuj ponownie
        </button>
      </div>
    );
  }
  if (loading) {
    return <p className="mt-2.5 text-[12.5px] text-ink-soft">Wczytywanie historii…</p>;
  }
  if (entries.length === 0) {
    return (
      <p className="mt-2.5 rounded-2xl border border-dashed border-line p-[15px] text-[12.5px] text-ink-soft">
        Brak zdarzeń w historii tej rzeczy.
      </p>
    );
  }
  return <ItemHistoryList entries={entries} />;
}

/** A vertical timeline, newest first: a dot per movement joined by a line. */
export function ItemHistoryList({ entries }: { entries: ItemHistoryEntryResponse[] }) {
  return (
    <ol aria-label="Historia rzeczy" className="mt-3">
      {entries.map((e, i) => {
        const last = i === entries.length - 1;
        return (
          <li key={`${e.occurred_at}-${e.movement_type}-${i}`} className="flex gap-3.5">
            <span aria-hidden="true" className="flex w-3.5 flex-none flex-col items-center">
              <span className={`mt-1 h-3.5 w-3.5 flex-none rounded-full ${i === 0 ? "bg-primary" : "bg-line-strong"}`} />
              {!last && <span className="w-0.5 flex-1 bg-line" />}
            </span>
            <div className={`min-w-0 flex-1 ${last ? "" : "pb-4"}`}>
              <p className="text-[15px] font-bold text-ink">{MOVEMENT_LABELS[e.movement_type]}</p>
              <p className="text-[13px] wrap-break-word text-ink-soft">{e.description}</p>
              {e.term_occurs_on && (
                <p className="text-[13px] text-ink-soft">
                  na terminie {dayjs(e.term_occurs_on).format("DD.MM.YYYY")}
                </p>
              )}
              <time dateTime={e.occurred_at} className="text-xs text-ink-soft">
                {dayjs(e.occurred_at).format("D MMM YYYY")}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
