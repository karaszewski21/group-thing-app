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

const CARD = "mt-4 rounded-[22px] border border-line bg-paper p-5";
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

/** "Aktualny status": the status is carried by its text, the pill colour only
 * reinforces it. Labels come from the server (privacy rule). */
export function ItemStatusCard({ status }: { status: ItemStatusResponse }) {
  const { title, detail, pill } = statusLines(status);
  return (
    <section className={CARD} aria-labelledby="item-status-heading">
      <h3 id="item-status-heading" className={CARD_LABEL}>
        Aktualny status
      </h3>
      <div className="mt-2.5 rounded-2xl border border-line bg-cream p-[15px]">
        <span
          role="status"
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-extrabold ${pill}`}
        >
          <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-current" />
          {title}
        </span>
        {detail && <p className="mt-1.5 text-[12.5px] text-ink-soft">{detail}</p>}
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

export function ItemHistoryList({ entries }: { entries: ItemHistoryEntryResponse[] }) {
  return (
    <ol aria-label="Historia rzeczy" className="mt-2.5">
      {entries.map((e, i) => {
        const at = dayjs(e.occurred_at);
        return (
          <li
            key={`${e.occurred_at}-${e.movement_type}-${i}`}
            className="mt-2.5 flex items-start gap-3 rounded-2xl border border-line bg-cream p-3 first:mt-0"
          >
            <time
              dateTime={e.occurred_at}
              className="flex h-10 w-10 flex-none flex-col items-center justify-center rounded-xl bg-primary-soft leading-none"
            >
              <b className="font-serif text-[15px] text-ink">{at.format("D")}</b>
              <small className="text-[9px] uppercase tracking-wide text-ink-soft">
                {at.format("MMM")}
              </small>
            </time>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold text-ink">
                {MOVEMENT_LABELS[e.movement_type]}
              </p>
              <p className="break-words text-[12.5px] text-ink-soft">{e.description}</p>
              {e.term_occurs_on && (
                <p className="text-[12.5px] text-ink-soft">
                  na terminie {dayjs(e.term_occurs_on).format("DD.MM.YYYY")}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
