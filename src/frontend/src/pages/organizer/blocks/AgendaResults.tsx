import { useState } from "react";
import type { UseOrganizerTermsResult } from "../../../hooks/useOrganizerTerms";
import { pluralPl } from "../../../utils/plural";
import { AgendaList } from "./AgendaList";
import { BlockSkeleton } from "./BlockSkeleton";

const SECONDARY_BUTTON =
  "flex min-h-11 items-center justify-center rounded-2xl border border-line bg-paper px-5 text-[14px] font-bold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-60";
const RETRY_BUTTON =
  "min-h-[44px] font-bold text-primary-fg underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

interface AgendaResultsProps {
  slug: string;
  agenda: UseOrganizerTermsResult;
  moreLabel: string;
  dayHeadingLevel: 2 | 3;
  /** Clears the circle filter; offered on an empty result when given. */
  onShowAll?: () => void;
}

/** The agenda's loading, error, empty and paged-list states, announcing how
 * many terms each further page brought. Key it by the circle filter so the
 * announcement starts over when the filter changes. */
export function AgendaResults({ slug, agenda, moreLabel, dayHeadingLevel, onShowAll }: AgendaResultsProps) {
  /** Terms shown before the last "more" click, to announce how many arrived. */
  const [countBeforeMore, setCountBeforeMore] = useState<number | null>(null);

  function showMore() {
    setCountBeforeMore(agenda.terms.length);
    void agenda.fetchNextPage();
  }

  if (agenda.loading) return <BlockSkeleton shape="rows" />;

  const loaded = countBeforeMore === null ? 0 : agenda.terms.length - countBeforeMore;
  const announcement =
    loaded > 0
      ? `Wczytano ${loaded} ${pluralPl(loaded, "kolejny termin", "kolejne terminy", "kolejnych terminów")}`
      : "";

  return (
    <div className="flex flex-col gap-3 px-6 pt-3">
      {agenda.error ? (
        <p className="text-[13px] text-ink-soft">
          Nie udało się wczytać terminów.{" "}
          <button type="button" onClick={() => void agenda.refetch()} className={RETRY_BUTTON}>
            Spróbuj ponownie
          </button>
        </p>
      ) : agenda.terms.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-paper px-6 py-6 text-center">
          <p className="font-serif text-[16px] font-semibold text-ink">Brak zaplanowanych zajęć</p>
          {onShowAll && (
            <button type="button" onClick={onShowAll} className={RETRY_BUTTON}>
              Pokaż wszystkie grupy
            </button>
          )}
        </div>
      ) : (
        <>
          <AgendaList slug={slug} terms={agenda.terms} dayHeadingLevel={dayHeadingLevel} />
          {agenda.nextPageError ? (
            <p className="text-[13px] text-ink-soft">
              Nie udało się wczytać kolejnych terminów.{" "}
              <button type="button" onClick={showMore} className={RETRY_BUTTON}>
                Spróbuj ponownie
              </button>
            </p>
          ) : (
            agenda.hasNextPage && (
              <button
                type="button"
                onClick={showMore}
                disabled={agenda.fetchingNextPage}
                className={`self-center ${SECONDARY_BUTTON}`}
              >
                {agenda.fetchingNextPage ? "Wczytywanie…" : moreLabel}
              </button>
            )
          )}
        </>
      )}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
