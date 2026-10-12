import type { ItemHistoryEntryResponse, ItemStatusResponse, MovementType } from "../../api/items";
import dayjs from "../../utils/dayjs";

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

function statusLines(status: ItemStatusResponse): { title: string; detail: string | null; pill: string } {
  const term = status.term_occurs_on ? dayjs(status.term_occurs_on).format("DD.MM") : null;
  const forLabel = status.counterparty_label ? `Dla: ${status.counterparty_label}` : null;
  switch (status.code) {
    case "AVAILABLE":
      return { title: "Dostępna", detail: null, pill: "bg-primary-soft text-primary-fg" };
    case "RESERVED":
      return {
        title: term ? `Zarezerwowana — odbiór na terminie ${term}` : "Zarezerwowana",
        detail: forLabel,
        pill: "bg-accent-soft text-ink",
      };
    case "IN_TRANSIT":
      return {
        title: term ? `W drodze — odbiór na terminie ${term}` : "W drodze",
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

/** "Aktualny status": a card in the status tone with a clock badge. The
 * status is carried by its text, the colour only reinforces it. Labels come
 * from the server (privacy rule). */
export function ItemStatusCard({ status }: { status: ItemStatusResponse }) {
  const { title, detail, pill } = statusLines(status);
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
