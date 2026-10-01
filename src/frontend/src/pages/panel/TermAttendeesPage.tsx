import { Link, useParams } from "react-router-dom";
import type { GroupResponse, TermAttendeeResponse } from "../../api/groups";
import type { TermResponse } from "../../api/terms";
import { PhoneFrame } from "../../components/shared/PhoneFrame";
import { useTermAttendees } from "../../hooks/useTermAttendees";
import { formatChildAges } from "../../utils/age";
import { pluralPl } from "../../utils/plural";
import { dayMonth, termPublicPath, termTime } from "./panelHelpers";
import { BackIcon } from "./panelIcons";

/** Organizer-only list of who signed up for one term (`/panel/terminy/:termId`).
 * A standalone route outside PanelDataProvider: the hook resolves the group
 * from the term itself. */
export function TermAttendeesPage() {
  const { termId = "" } = useParams();
  const { term, group, attendees, denied, notFound, error, loading, refetch } =
    useTermAttendees(termId);

  return (
    <PhoneFrame>
      <div className="flex-1 overflow-y-auto px-[18px] pb-6 pt-[18px]">
        <Link
          to="/panel/spotkania"
          className="mb-4 inline-flex items-center gap-1.5 text-xs font-bold text-ink-soft"
        >
          <BackIcon /> Wróć
        </Link>
        <h2 className="text-[19px] font-semibold text-ink">Zapisani</h2>
        <TermAttendeesBody
          term={term}
          group={group}
          attendees={attendees}
          denied={denied}
          notFound={notFound}
          error={error}
          loading={loading}
          onRetry={() => void refetch()}
        />
      </div>
    </PhoneFrame>
  );
}

interface TermAttendeesBodyProps {
  term: TermResponse | null;
  group: GroupResponse | null;
  attendees: TermAttendeeResponse[];
  denied: boolean;
  notFound: boolean;
  error: string | null;
  loading: boolean;
  onRetry: () => void;
}

function TermAttendeesBody({
  term,
  group,
  attendees,
  denied,
  notFound,
  error,
  loading,
  onRetry,
}: TermAttendeesBodyProps) {
  if (denied) {
    return <p className="mt-3 text-[12.5px] text-ink-soft">Nie masz dostępu do tego terminu.</p>;
  }
  if (notFound) {
    return <p className="mt-3 text-[12.5px] text-ink-soft">Nie znaleziono tego terminu.</p>;
  }
  if (error) {
    return (
      <div className="mt-3">
        <p className="text-[12.5px] font-semibold text-danger">
          Nie udało się wczytać zapisanych — spróbuj ponownie
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

  const termCard = term && group ? <TermHeadCard term={term} group={group} /> : null;

  if (loading) {
    return (
      <>
        {termCard}
        <p className="mt-4 text-[12.5px] text-ink-soft">Wczytywanie zapisanych…</p>
      </>
    );
  }

  const childTotal = attendees.reduce((sum, a) => sum + a.child_count, 0);

  return (
    <>
      <p className="mt-0.5 text-[12.5px] text-ink-soft">
        {attendees.length === 0
          ? "Brak zapisów"
          : `${attendees.length} ${pluralPl(attendees.length, "zapis", "zapisy", "zapisów")} · ${childTotal} ${pluralPl(childTotal, "dziecko", "dzieci", "dzieci")}`}
      </p>
      {termCard}
      {attendees.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-line p-[15px] text-[12.5px] text-ink-soft">
          Nikt jeszcze nie zapisał się na ten termin.
        </p>
      ) : (
        <div className="mt-4 rounded-[22px] border border-line bg-paper p-5">
          <ul>
            {attendees.map((a) => (
              <TermAttendeeRow key={a.party_id} attendee={a} />
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function TermHeadCard({ term, group }: { term: TermResponse; group: GroupResponse }) {
  const { day, month } = dayMonth(term.occurs_on);
  const time = termTime(term.occurs_on);

  return (
    <div className="mt-4 rounded-2xl border border-line bg-cream p-[15px]">
      <div className="flex items-start gap-3.5">
        <div className="flex h-[46px] w-[46px] flex-none flex-col items-center justify-center rounded-[13px] bg-mint-soft leading-none">
          <b className="font-serif text-base text-ink">{day}</b>
          <small className="text-[9.5px] uppercase tracking-wide text-ink-soft">{month}</small>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15.5px] font-semibold text-ink">{group.name}</p>
          <p className="mt-0.5 text-[12.5px] text-ink-soft">
            {time && <span className="font-bold text-ink">godz. {time}</span>}
            {time && (term.description ? " · " : "")}
            {term.description || (time ? "" : "Bez opisu")}
          </p>
          <Link
            to={termPublicPath(group, term.id)}
            className="mt-1 inline-block text-[12.5px] font-bold text-mint hover:underline"
          >
            Zobacz stronę terminu ›
          </Link>
        </div>
      </div>
    </div>
  );
}

function attendancePill(childCount: number): string {
  if (childCount === 0) return "przychodzi bez dzieci";
  if (childCount === 1) return "przychodzi z 1 dzieckiem";
  return `przychodzi z ${childCount} dzieci`;
}

function TermAttendeeRow({ attendee }: { attendee: TermAttendeeResponse }) {
  const ages = formatChildAges(attendee.children.map((c) => c.birth_year));
  const pillClass =
    attendee.child_count === 0
      ? "border border-line bg-cream text-ink-soft"
      : "bg-mint-soft text-[#12604D]";

  return (
    <li className="mt-2.5 rounded-2xl border border-line bg-cream p-[15px] first:mt-0">
      <div className="min-w-0">
        <p className="text-[15.5px] font-semibold text-ink">{attendee.display_name}</p>
        {attendee.family_name && (
          <p className="text-[12.5px] text-ink-soft">{attendee.family_name}</p>
        )}
        <span
          className={`mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-[10.5px] font-extrabold ${pillClass}`}
        >
          {attendancePill(attendee.child_count)}
        </span>
        <p className="mt-1.5 text-[12.5px] text-ink-soft">
          {ages ? `dzieci w rodzinie: ${ages}` : "brak dzieci w profilu rodziny"}
        </p>
      </div>
    </li>
  );
}
