import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import dayjs from "../../utils/dayjs";
import { pluralPl } from "../../utils/plural";
import { SubPageHeader } from "../../components/shared/appComponents";
import { FamilyIcon } from "../../components/shared/appIcons";
import { termTime, viewPath, type GuestTermCard, type TermWithNeeded } from "../../utils/appHelpers";
import { useAppData } from "../../app/appDataStore";
import { useMyPledges } from "../../hooks/useMyPledges";
import { OrganizerTermCard, SavedTermCard } from "./TermCards";

const SECTION_TITLE = "font-serif text-[21px] font-bold text-ink";
const SECTION_COUNT = "font-sans text-base font-semibold text-ink-soft";
const EMPTY = "rounded-[22px] border border-dashed border-line bg-paper p-5 text-center text-[13px] text-ink-soft";

/** A led term or a guest card — whatever a `TermList` row is built from. */
type ListedTerm = TermWithNeeded | GuestTermCard;

const termIdOf = (entry: ListedTerm) => ("term" in entry ? entry.term.id : entry.termId);
const occursOnOf = (entry: ListedTerm) => ("term" in entry ? entry.term.occurs_on : entry.occursOn);

interface TermSections<T> {
  thisWeek: T[];
  later: T[];
  past: T[];
}

/** Splits terms by date: from today to a week ahead, later, and past. */
function splitTerms<T extends ListedTerm>(list: T[]): TermSections<T> {
  const today = dayjs().startOf("day");
  const weekEnd = today.add(7, "day");
  const sections: TermSections<T> = { thisWeek: [], later: [], past: [] };
  for (const entry of list) {
    const at = dayjs(occursOnOf(entry));
    if (at.isBefore(today)) sections.past.push(entry);
    else if (at.isBefore(weekEnd)) sections.thisWeek.push(entry);
    else sections.later.push(entry);
  }
  sections.past.reverse();
  return sections;
}

/** "Ten tydzień" / "Później" groups, and the past terms behind a toggle; with
 * nothing upcoming the past terms show right away instead of an empty list. */
function TermList<T extends ListedTerm>({ list, renderTerm }: { list: T[]; renderTerm: (entry: T) => ReactNode }) {
  const [showPast, setShowPast] = useState(false);
  const { thisWeek, later, past } = splitTerms(list);
  const nothingUpcoming = thisWeek.length === 0 && later.length === 0;
  const pastOpen = showPast || nothingUpcoming;

  const group = (label: string, entries: T[]) =>
    entries.length > 0 && (
      <div className="flex flex-col gap-2.5">
        <p className="text-xs font-extrabold tracking-[.14em] text-ink-soft uppercase">{label}</p>
        {entries.map((entry) => (
          <div key={termIdOf(entry)}>{renderTerm(entry)}</div>
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

type Tab = "organizujesz" | "udzial";

const TABS: { id: Tab; label: string }[] = [
  { id: "organizujesz", label: "Organizujesz" },
  { id: "udzial", label: "Biorę udział" },
];

export function MeetingsView() {
  const {
    myGroups,
    terms,
    savedCards,
    selectTermGroup,
    showToast,
    load,
  } = useAppData();
  const { data: myPledges, withdraw } = useMyPledges();

  async function withdrawMyPledge(pledgeId: string) {
    try {
      await withdraw(pledgeId);
    } catch {
      showToast("Nie udało się wycofać zgłoszenia");
      return;
    }
    showToast("Wycofano zgłoszenie");
    // The pledge's needed item may sit on one of the caller's own terms.
    void load({ silent: true });
  }
  const [tab, setTab] = useState<Tab>("organizujesz");
  const sections = splitTerms(terms);
  const upcoming = sections.thisWeek.length + sections.later.length;
  const hasGroups = myGroups.length > 0;
  return (
    <>
      <SubPageHeader
        title="Spotkania"
        backTo="/"
        backLabel="Wróć na Start"
        action={
          <Link
            to={viewPath("groups")}
            className="flex min-h-11 items-center gap-1.5 rounded-full border-[1.5px] border-line bg-paper px-3.5 text-sm font-extrabold text-ink hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <FamilyIcon c="currentColor" /> Moje grupy
          </Link>
        }
      />
      <div role="tablist" aria-label="Rodzaj spotkań" className="mb-5 grid grid-cols-2 gap-1 rounded-full bg-line p-1">
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`spotkania-tab-${t.id}`}
              aria-selected={on}
              aria-controls={`spotkania-panel-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`min-h-10.5 rounded-full text-[15px] font-extrabold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
                on ? "bg-paper text-ink shadow-[0_2px_8px_-2px_rgba(42,35,32,0.25)]" : "text-ink-soft hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "organizujesz" ? (
        <div role="tabpanel" id="spotkania-panel-organizujesz" aria-labelledby="spotkania-tab-organizujesz">
          <section>
            <div className="mb-3 flex items-center justify-between gap-2.5">
              <div className="flex items-baseline gap-1.5">
                <h2 className={SECTION_TITLE}>Terminy</h2>
                <span className={SECTION_COUNT}>
                  · {upcoming > 0 ? `${upcoming} ${pluralPl(upcoming, "nadchodzący", "nadchodzące", "nadchodzących")}` : terms.length}
                </span>
              </div>
              {hasGroups && (
                <Link
                  to={viewPath("add/term")}
                  onClick={() => selectTermGroup(myGroups[0].id)}
                  className="flex min-h-10 flex-none items-center rounded-full bg-primary px-3.5 text-sm font-extrabold text-on-primary"
                >
                  + Dodaj termin
                </Link>
              )}
            </div>
            {terms.length === 0 ? (
              <div className={EMPTY}>Brak zaplanowanych terminów.</div>
            ) : (
              <TermList
                list={terms}
                renderTerm={({ term, group, neededItems }) => (
                  <OrganizerTermCard term={term} group={group} neededItems={neededItems} />
                )}
              />
            )}
          </section>
        </div>
      ) : (
        <div role="tabpanel" id="spotkania-panel-udzial" aria-labelledby="spotkania-tab-udzial">
          <section>
            <div className="mb-3 flex items-baseline gap-1.5">
              <h2 className={SECTION_TITLE}>Zapisane</h2>
              <span className={SECTION_COUNT}>· {savedCards.length}</span>
            </div>
            {savedCards.length === 0 ? (
              <div className={EMPTY}>Nie masz jeszcze zapisów na zajęcia.</div>
            ) : (
              <TermList list={savedCards} renderTerm={(card) => <SavedTermCard card={card} />} />
            )}
          </section>

          <section className="mt-7">
            <div className="mb-3 flex items-baseline gap-1.5">
              <h2 className={SECTION_TITLE}>Zadeklarowane rzeczy</h2>
              <span className={SECTION_COUNT}>· {myPledges.length}</span>
            </div>
            {myPledges.length === 0 ? (
              <div className={EMPTY}>Brak deklaracji przyniesienia rzeczy.</div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {myPledges.map((p) => {
                  const time = termTime(p.occurs_on);
                  return (
                    <div key={p.pledge_id} className="flex items-start gap-3 rounded-[22px] border border-line bg-paper p-3.5">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-[15px] font-bold wrap-break-word text-ink">
                          {p.item_name}
                          {p.item_description ? ` — ${p.item_description}` : ""}
                        </h3>
                        <small className="mt-0.5 block text-sm text-ink-soft">
                          {p.group_name} · {dayjs(p.occurs_on).format("D MMM")}
                          {time ? `, godz. ${time}` : ""}
                        </small>
                      </div>
                      {p.status !== "WITHDRAWN" && (
                        <button
                          onClick={() => void withdrawMyPledge(p.pledge_id)}
                          className="min-h-9 flex-none rounded-full border-[1.5px] border-line px-3 text-xs font-bold text-danger hover:bg-cream"
                        >
                          Rezygnuję
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

    </>
  );
}
