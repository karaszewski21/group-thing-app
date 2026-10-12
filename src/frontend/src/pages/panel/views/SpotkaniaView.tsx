import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import dayjs from "../../../utils/dayjs";
import { pluralPl } from "../../../utils/plural";
import { LayoutModeIcon, PencilIcon, TrashIcon } from "../panelIcons";
import { dayMonth, termPublicPath, termTime, type TermWithNeeded } from "../panelHelpers";
import { usePanelData } from "../panelDataStore";

const SECTION_TITLE = "font-serif text-[21px] font-bold text-ink";
const SECTION_COUNT = "font-sans text-base font-semibold text-ink-soft";
const EMPTY = "rounded-[22px] border border-dashed border-line bg-paper p-5 text-center text-[13px] text-ink-soft";
const GROUP_TONES = ["bg-accent-soft", "bg-primary-soft"];
const LAYOUT_LABEL = { CIRCLE: "Krąg", PITCH: "Boisko", TABLE: "Stół" } as const;
const GROUP_ICON_TONES = ["bg-accent text-ink", "bg-primary text-on-primary"];
const TILE_BUTTON =
  "flex h-9 w-9 items-center justify-center rounded-full bg-paper/70 text-ink transition-colors hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

interface TermSections {
  thisWeek: TermWithNeeded[];
  later: TermWithNeeded[];
  past: TermWithNeeded[];
}

/** Splits terms by date: from today to a week ahead, later, and past. */
function splitTerms(list: TermWithNeeded[]): TermSections {
  const today = dayjs().startOf("day");
  const weekEnd = today.add(7, "day");
  const sections: TermSections = { thisWeek: [], later: [], past: [] };
  for (const entry of list) {
    const at = dayjs(entry.term.occurs_on);
    if (at.isBefore(today)) sections.past.push(entry);
    else if (at.isBefore(weekEnd)) sections.thisWeek.push(entry);
    else sections.later.push(entry);
  }
  sections.past.reverse();
  return sections;
}

/** "Ten tydzień" / "Później" groups, and the past terms behind a toggle; with
 * nothing upcoming the past terms show right away instead of an empty list. */
function TermList({ list, renderTerm }: { list: TermWithNeeded[]; renderTerm: (entry: TermWithNeeded) => ReactNode }) {
  const [showPast, setShowPast] = useState(false);
  const { thisWeek, later, past } = splitTerms(list);
  const nothingUpcoming = thisWeek.length === 0 && later.length === 0;
  const pastOpen = showPast || nothingUpcoming;

  const group = (label: string, entries: TermWithNeeded[]) =>
    entries.length > 0 && (
      <div className="flex flex-col gap-2.5">
        <p className="text-xs font-extrabold tracking-[.14em] text-ink-soft uppercase">{label}</p>
        {entries.map((entry) => (
          <div key={entry.term.id}>{renderTerm(entry)}</div>
        ))}
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      {group("Ten tydzień", thisWeek)}
      {group("Później", later)}
      {pastOpen && group("Minione", past)}
      {past.length > 0 && !nothingUpcoming && (
        <button
          type="button"
          aria-expanded={showPast}
          onClick={() => setShowPast((open) => !open)}
          className="min-h-12 rounded-full border-[1.5px] border-dashed border-line-strong text-[15px] font-bold text-ink-soft hover:text-ink"
        >
          {showPast ? "Ukryj minione terminy" : `Pokaż minione terminy (${past.length})`}
        </button>
      )}
    </div>
  );
}

export function SpotkaniaView() {
  const {
    isOrganizer,
    myGroups,
    terms,
    myAttendances,
    groupExtras,
    setModal,
    setTermGroupId,
    startEditGroup,
    handleRemoveGroup,
    organizerTermCard,
  } = usePanelData();

  // GUEST only: an RSVP on the public term page never creates a `Membership`
  // row, so `terms` (built from Circle-membership in PanelDataContext) alone
  // misses any session the caller merely signed up for without ever joining
  // that Circle — this merges those in, LOCAL to this view only (not lifted
  // into the shared `terms` context state, which Home's own "Najbliższe
  // terminy" section also reads — merging there would duplicate the same
  // card under both that section and Home's separate "Zapisane zajęcia").
  // Built directly from `MyAttendanceResponse`, which already carries
  // everything this card needs (date, circle name, organizer slug) with no
  // second request, per that type's own docstring; `description`/
  // `neededItems` are unavailable in that shape and degrade to empty/null.
  const guestTerms = useMemo<TermWithNeeded[]>(() => {
    if (isOrganizer) return terms;
    const coveredTermIds = new Set(terms.map((t) => t.term.id));
    const extraTerms: TermWithNeeded[] = myAttendances
      .filter((a) => !coveredTermIds.has(a.term_id))
      .map((attendance) => ({
        term: {
          id: attendance.term_id,
          circle_group_id: attendance.group_id,
          occurs_on: attendance.occurs_on,
          description: null,
          created_at: attendance.occurs_on,
          updated_at: attendance.occurs_on,
          attendee_count: null,
          child_count: null,
        },
        group: {
          id: attendance.group_id,
          party_id: attendance.group_id,
          name: attendance.group_name,
          organizer_slug: attendance.organizer_slug,
          layout_mode: "CIRCLE",
          visibility: "PUBLIC",
          created_at: attendance.occurs_on,
          updated_at: attendance.occurs_on,
        },
        neededItems: [],
      }));
    return [...terms, ...extraTerms].sort((a, b) => a.term.occurs_on.localeCompare(b.term.occurs_on));
  }, [isOrganizer, terms, myAttendances]);

  if (isOrganizer) {
    const sections = splitTerms(terms);
    const upcoming = sections.thisWeek.length + sections.later.length;
    return (
      <>
        <h1 className="mb-5 font-serif text-[32px] leading-tight font-extrabold tracking-tight text-ink">Spotkania</h1>

        <section>
          <div className="mb-2.5 flex items-center justify-between gap-2.5">
            <div className="flex items-baseline gap-1.5">
              <h2 className={SECTION_TITLE}>Grupy</h2>
              <span className={SECTION_COUNT}>· {myGroups.length}</span>
            </div>
            <button
              onClick={() => setModal("grupa")}
              className="min-h-10 flex-none rounded-full border-[1.5px] border-line bg-paper px-3.5 text-sm font-extrabold text-ink hover:border-line-strong"
            >
              + Dodaj grupę
            </button>
          </div>
          {myGroups.length === 0 ? (
            <div className={EMPTY}>Nie masz jeszcze żadnej grupy.</div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {myGroups.map((g, index) => {
                const extra = groupExtras[g.id];
                const termCount = terms.filter((t) => t.group.id === g.id).length;
                return (
                  <div
                    key={g.id}
                    className={`flex min-h-36 flex-col justify-between gap-3 rounded-[22px] p-3.5 ${GROUP_TONES[index % 2]}`}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <button
                        type="button"
                        onClick={() => startEditGroup(g)}
                        aria-label={`Zmień układ grupy ${g.name} (${LAYOUT_LABEL[g.layout_mode]})`}
                        title={`Układ: ${LAYOUT_LABEL[g.layout_mode]}`}
                        className={`flex h-10 w-10 items-center justify-center rounded-full transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${GROUP_ICON_TONES[index % 2]}`}
                      >
                        <LayoutModeIcon mode={g.layout_mode} />
                      </button>
                      <div className="flex gap-1">
                        <button onClick={() => startEditGroup(g)} aria-label={`Edytuj grupę ${g.name}`} className={TILE_BUTTON}>
                          <PencilIcon />
                        </button>
                        <button
                          onClick={() => void handleRemoveGroup(g.id)}
                          aria-label={`Usuń grupę ${g.name}`}
                          className={`${TILE_BUTTON} hover:text-danger`}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-base font-extrabold wrap-break-word text-ink">{g.name}</h3>
                      <small className="block text-[13px] text-ink-soft">
                        {extra?.location || `${termCount} ${pluralPl(termCount, "termin", "terminy", "terminów")}`}
                      </small>
                      {extra && extra.freeSpots > 0 && (
                        <span className="mt-1.5 inline-block rounded-full bg-paper/70 px-2.5 py-0.5 text-xs font-extrabold text-ink">
                          wolne {extra.freeSpots} miejsca
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="mt-7">
          <div className="mb-3 flex items-baseline gap-1.5">
            <h2 className={SECTION_TITLE}>Terminy</h2>
            <span className={SECTION_COUNT}>
              · {upcoming > 0 ? `${upcoming} ${pluralPl(upcoming, "nadchodzący", "nadchodzące", "nadchodzących")}` : terms.length}
            </span>
          </div>
          {terms.length === 0 ? (
            <div className={EMPTY}>Brak zaplanowanych terminów.</div>
          ) : (
            <TermList
              list={terms}
              renderTerm={({ term, group, neededItems }) => organizerTermCard(term, group, neededItems)}
            />
          )}
        </section>

        {/* Always floats just above the bottom tab bar, whatever the scroll position. */}
        <div className="pointer-events-none fixed inset-x-0 bottom-[86px] z-30 mx-auto flex max-w-[1200px] justify-end px-4">
          <button
            onClick={() => {
              setTermGroupId(myGroups[0]?.id ?? null);
              setModal("termin");
            }}
            className="pointer-events-auto flex min-h-14 items-center rounded-full bg-primary px-5.5 text-base font-extrabold text-on-primary shadow-[0_12px_24px_-12px_var(--color-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            + Dodaj termin
          </button>
        </div>
        {/* Room under the floating button, so at the end of the list it never covers the last row. */}
        <div aria-hidden="true" className="h-20" />
      </>
    );
  }

  return (
    <div>
      <h1 className="font-serif text-[32px] leading-tight font-extrabold tracking-tight text-ink">Spotkania</h1>
      <p className="mt-1 mb-5 text-sm text-ink-soft">
        {guestTerms.length === 0
          ? "Nie masz jeszcze zapisów na zajęcia"
          : `${guestTerms.length} ${pluralPl(guestTerms.length, "termin", "terminy", "terminów")} z Twoimi zapisami`}
      </p>
      {guestTerms.length === 0 ? (
        <div className={EMPTY}>Nie masz jeszcze zapisów na zajęcia.</div>
      ) : (
        <TermList
          list={guestTerms}
          renderTerm={({ term, group, neededItems }) => {
            const { day, month } = dayMonth(term.occurs_on);
            const time = termTime(term.occurs_on);
            return (
              <Link
                to={termPublicPath(group, term.id)}
                className="flex items-start gap-3 rounded-[22px] border border-line bg-paper p-3.5 transition-colors hover:border-line-strong"
              >
                <div className="flex h-14.5 w-13 flex-none flex-col items-center justify-center rounded-2xl bg-primary-soft leading-none">
                  <b className="font-serif text-[22px] font-extrabold text-ink">{day}</b>
                  <small className="mt-0.5 text-[10px] font-extrabold tracking-wide text-primary-fg uppercase">{month}</small>
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="text-base font-bold text-ink">{group.name}</h4>
                  <small className="mt-0.5 block text-sm text-ink-soft">
                    {time && <span className="font-bold text-ink">godz. {time}</span>}
                    {time && (term.description ? " · " : "")}
                    {term.description || (time ? "" : "Bez opisu")}
                  </small>
                  {neededItems.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {neededItems.map((ni) => (
                        <span
                          key={ni.id}
                          className="rounded-full border-[1.5px] border-dashed border-accent px-2.5 py-0.5 text-xs font-extrabold text-accent-fg"
                        >
                          {ni.product_name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </Link>
            );
          }}
        />
      )}
    </div>
  );
}
