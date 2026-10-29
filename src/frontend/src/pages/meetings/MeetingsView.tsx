import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { EventResponse } from "../../api/events";
import type { MyPledgeResponse } from "../../api/pledges";
import dayjs from "../../utils/dayjs";
import { SubPageHeader } from "../../components/shared/appComponents";
import { FamilyIcon } from "../../components/shared/appIcons";
import { viewPath, type GuestTermCard, type TermWithNeeded } from "../../utils/appHelpers";
import { useAppData } from "../../app/appDataStore";
import { useMyEvents } from "../../hooks/useMyEvents";
import { useMyPledges } from "../../hooks/useMyPledges";
import { EventCard, OrganizerTermCard, SavedTermCard } from "./TermCards";

const EMPTY = "rounded-[22px] border border-dashed border-line bg-paper p-5 text-center text-[13px] text-ink-soft";

/** A led term, an own event or a guest card — whatever a `TermList` row is built from. */
type ListedTerm = TermWithNeeded | EventResponse | GuestTermCard;

const termIdOf = (entry: ListedTerm) =>
  "term" in entry ? entry.term.id : "starts_at" in entry ? entry.id : entry.termId;
const occursOnOf = (entry: ListedTerm) =>
  "term" in entry ? entry.term.occurs_on : "starts_at" in entry ? entry.starts_at : entry.occursOn;

const byDate = (a: ListedTerm, b: ListedTerm) => occursOnOf(a).localeCompare(occursOnOf(b));

/** A card for a term known only from a pledge (no RSVP, no family circle). */
function pledgeTermCard(pledge: MyPledgeResponse): GuestTermCard {
  return {
    termId: pledge.term_id,
    occursOn: pledge.occurs_on,
    groupName: pledge.group_name,
    description: null,
    href: `/${pledge.organizer_slug}/group/${pledge.group_id}/term/${pledge.term_id}`,
    location: null,
    capacity: null,
    attendeeCount: null,
    neededItems: [],
  };
}

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
  const { terms, savedCards, showToast, load } = useAppData();
  const { data: myEvents } = useMyEvents();
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

  const organized: (TermWithNeeded | EventResponse)[] = [...terms, ...myEvents].sort(byDate);

  // Each pledge shows on its term's card; a pledged-for term with no card of
  // its own gets one.
  const pledgesByTerm = new Map<string, MyPledgeResponse[]>();
  for (const pledge of myPledges) {
    if (pledge.status === "WITHDRAWN") continue;
    pledgesByTerm.set(pledge.term_id, [...(pledgesByTerm.get(pledge.term_id) ?? []), pledge]);
  }
  const savedIds = new Set(savedCards.map((c) => c.termId));
  const pledgeOnlyCards = [...pledgesByTerm.values()]
    .map((pledges) => pledges[0])
    .filter((p) => !savedIds.has(p.term_id))
    .map(pledgeTermCard);
  const attending = [...savedCards, ...pledgeOnlyCards].sort(byDate);

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
          {organized.length === 0 ? (
            <div className={EMPTY}>Brak zaplanowanych spotkań.</div>
          ) : (
            <TermList
              list={organized}
              renderTerm={(entry) =>
                "term" in entry ? (
                  <OrganizerTermCard term={entry.term} group={entry.group} neededItems={entry.neededItems} />
                ) : (
                  <EventCard event={entry} />
                )
              }
            />
          )}
        </div>
      ) : (
        <div role="tabpanel" id="spotkania-panel-udzial" aria-labelledby="spotkania-tab-udzial">
          {attending.length === 0 ? (
            <div className={EMPTY}>Nie masz jeszcze zapisów na zajęcia.</div>
          ) : (
            <TermList
              list={attending}
              renderTerm={(card) => (
                <SavedTermCard
                  card={card}
                  pledges={pledgesByTerm.get(card.termId) ?? []}
                  onWithdrawPledge={(pledgeId) => void withdrawMyPledge(pledgeId)}
                />
              )}
            />
          )}
        </div>
      )}
    </>
  );
}
