import { useMyPoints, useMyPointsHistory } from "../../hooks/useMyPoints";
import { PointsHistoryRow } from "./PointsHistoryRow";
import { PointsTiles } from "./PointsTiles";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const MORE_BUTTON = `mt-3 flex min-h-11 w-full items-center justify-center rounded-xl border border-line bg-paper px-4 text-[13px] font-semibold text-ink disabled:opacity-60 ${FOCUS_RING}`;
const ALERT = "rounded-2xl bg-danger-soft px-3 py-2.5 text-sm text-danger";

function History() {
  const history = useMyPointsHistory();
  if (history.loading) return <p className="mt-2 text-[13px] text-ink-soft">Ładowanie historii…</p>;
  if (history.error) {
    return (
      <p role="alert" className={`mt-2 ${ALERT}`}>
        {history.error}
      </p>
    );
  }
  if (history.entries.length === 0) {
    return <p className="mt-2 text-[13px] text-ink-soft">Nie masz jeszcze żadnych punktów.</p>;
  }
  return (
    <>
      <ul aria-labelledby="points-history" className="mt-1 flex flex-col gap-2.5 pt-1.5">
        {history.entries.map((entry) => (
          <PointsHistoryRow key={entry.id} entry={entry} />
        ))}
      </ul>
      {history.nextPageError ? (
        <p role="alert" className={`mt-3 ${ALERT}`}>
          Nie udało się wczytać starszych wpisów.{" "}
          <button type="button" onClick={() => void history.fetchNextPage()} className={`font-bold underline ${FOCUS_RING}`}>
            Spróbuj ponownie
          </button>
        </p>
      ) : (
        history.hasNextPage && (
          <button
            type="button"
            onClick={() => void history.fetchNextPage()}
            disabled={history.fetchingNextPage}
            className={MORE_BUTTON}
          >
            {history.fetchingNextPage ? "Wczytywanie…" : "Pokaż starsze"}
          </button>
        )
      )}
    </>
  );
}

/** „Twoje punkty” (/points): the owner's balance, reputation and
 * history. Nobody else sees these numbers. */
export function AccountPointsView() {
  const { data: summary, error } = useMyPoints();
  return (
    <section aria-labelledby="points-heading" className="rounded-[22px] border border-line bg-paper p-5">
      <h2 id="points-heading" className="m-0 text-lg font-extrabold text-ink">
        Twoje punkty
      </h2>
      <p className="mt-0.5 text-[12.5px] text-ink-soft">Widzisz to tylko Ty.</p>
      {error ? (
        <p role="alert" className={`mt-3 ${ALERT}`}>
          {error}
        </p>
      ) : (
        <div className="mt-3">
          <PointsTiles balance={summary?.balance} reputation={summary?.reputation} />
        </div>
      )}
      <p className="mt-3 rounded-[14px] bg-lime-soft px-[13px] py-2.5 text-[12.5px] font-semibold text-accent-fg">
        Wydawanie punktów — wkrótce. Będzie można je wymienić na nieliczne przedmioty oznaczone „za punkty”.
      </p>
      <h3 id="points-history" className="mt-[18px] text-sm font-extrabold text-ink">
        Historia
      </h3>
      <History />
      <p className="mt-3.5 text-[12.5px] text-ink-soft">
        Jak zdobywać punkty: oddawaj rzeczy za darmo, wymieniaj się i przychodź na spotkania. Przekazania w rodzinie i
        częste przekazania tej samej osobie nie dają punktów.
      </p>
    </section>
  );
}
