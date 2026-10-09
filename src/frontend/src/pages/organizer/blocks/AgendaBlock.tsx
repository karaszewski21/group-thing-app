import { useState } from "react";
import { useOrganizerTerms } from "../../../hooks/useOrganizerTerms";
import { pluralPl } from "../../../utils/plural";
import type { BlockProps, OrganizerPageData } from "../layouts/types";
import { AgendaList } from "./AgendaList";
import { BlockSkeleton } from "./BlockSkeleton";
import { CircleFilterChips } from "./CircleFilterChips";

const SECONDARY_BUTTON =
  "flex min-h-11 items-center justify-center rounded-2xl border border-line bg-paper px-5 text-[14px] font-bold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-60";
const RETRY_BUTTON =
  "min-h-[44px] font-bold text-primary-fg underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

// eslint-disable-next-line react-refresh/only-export-components -- the renderer reads each block's isEmpty next to it
export function isAgendaEmpty(data: OrganizerPageData): boolean {
  return !data.directory || data.directory.circles.every((circle) => circle.next_term === null);
}

/** `by-day`: the organizer's full forward agenda, a page at a time, with a
 * circle filter when there are at least 2 circles. */
export function AgendaBlock({ data }: BlockProps) {
  const [groupId, setGroupId] = useState<string | undefined>();
  /** Terms shown before the last "Pokaż kolejne terminy", to announce how many arrived. */
  const [countBeforeMore, setCountBeforeMore] = useState<number | null>(null);
  const agenda = useOrganizerTerms(data.organization.slug, groupId);
  const circles = data.directory?.circles ?? [];

  function selectCircle(id: string | undefined) {
    setGroupId(id);
    setCountBeforeMore(null);
  }

  function showMore() {
    setCountBeforeMore(agenda.terms.length);
    void agenda.fetchNextPage();
  }

  const loaded = countBeforeMore === null ? 0 : agenda.terms.length - countBeforeMore;
  const announcement =
    loaded > 0
      ? `Wczytano ${loaded} ${pluralPl(loaded, "kolejny termin", "kolejne terminy", "kolejnych terminów")}`
      : "";

  if (agenda.notFound) return null;

  return (
    <section>
      <div className="flex flex-col gap-3 px-6 pt-6">
        <h2 className="font-serif text-lg font-semibold text-ink">Plan zajęć</h2>
        <CircleFilterChips circles={circles} selected={groupId} onSelect={selectCircle} />
      </div>
      {agenda.loading ? (
        <BlockSkeleton shape="rows" />
      ) : (
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
              {groupId !== undefined && (
                <button type="button" onClick={() => selectCircle(undefined)} className={RETRY_BUTTON}>
                  Pokaż wszystkie grupy
                </button>
              )}
            </div>
          ) : (
            <>
              <AgendaList slug={data.organization.slug} terms={agenda.terms} />
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
                    {agenda.fetchingNextPage ? "Wczytywanie…" : "Pokaż kolejne terminy"}
                  </button>
                )
              )}
            </>
          )}
          <p aria-live="polite" className="sr-only">
            {announcement}
          </p>
        </div>
      )}
    </section>
  );
}
