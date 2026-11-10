import type { ReactNode } from "react";
import type { UseMyTermsResult } from "../../../hooks/useMyTerms";
import { useLoadMoreOnScroll } from "../../../hooks/useLoadMoreOnScroll";
import { listedTermId, type ListedTerm } from "../meetingsList";

const EMPTY = "rounded-[22px] border border-dashed border-line bg-paper p-5 text-center text-[13px] text-ink-soft";

interface TermListProps<T extends ListedTerm> {
  entries: T[];
  paged: UseMyTermsResult;
  loading: boolean;
  error: string | null;
  emptyText: string;
  renderTerm: (entry: T) => ReactNode;
}

/** One `/meetings` tab's list, latest date first; the next page loads as its
 * end scrolls into view. Shows the loading and empty states of the tab. */
export function TermList<T extends ListedTerm>({ entries, paged, loading, error, emptyText, renderTerm }: TermListProps<T>) {
  const { hasNextPage, fetchingNextPage, nextPageError, fetchNextPage } = paged;
  const sentinel = useLoadMoreOnScroll(
    () => void fetchNextPage(),
    !loading && hasNextPage && !fetchingNextPage && nextPageError === null,
  );

  return (
    <>
      {error && (
        <p role="alert" className="mb-4 text-center text-[13px] font-semibold text-danger">
          Nie udało się wczytać spotkań — {error}
        </p>
      )}
      {loading ? (
        <div className={EMPTY}>Wczytywanie spotkań…</div>
      ) : entries.length === 0 ? (
        <div className={EMPTY}>{emptyText}</div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {entries.map((entry) => (
            <div key={listedTermId(entry)}>{renderTerm(entry)}</div>
          ))}
          {hasNextPage && <div ref={sentinel} aria-hidden="true" className="h-px" />}
          {fetchingNextPage && (
            <p role="status" className="text-center text-[13px] text-ink-soft">
              Wczytywanie kolejnych spotkań…
            </p>
          )}
          {nextPageError && (
            <div className="flex flex-col items-center gap-1.5">
              <p role="alert" className="text-center text-xs font-semibold text-danger">
                Nie udało się wczytać kolejnych spotkań
              </p>
              <button
                type="button"
                onClick={() => void fetchNextPage()}
                className="min-h-11 rounded-full border-[1.5px] border-line bg-paper px-4 text-sm font-bold text-ink hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                Spróbuj ponownie
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
