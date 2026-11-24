import { useState } from "react";
import { Link, useAppParams } from "../../routing/navigation";
import type { GroupResponse, TermAttendanceResponse, TermAttendeeResponse } from "../../api/groups";
import type { TermResponse } from "../../api/terms";
import { Switch } from "../../components/shared/appComponents";
import { ConfirmDeleteDialog } from "../../components/shared/ConfirmDeleteDialog";
import { useOpenAndNavigate } from "../../hooks/useOpenAndNavigate";
import { useTermAttendance } from "../../hooks/useTermAttendance";
import { useTermAttendees } from "../../hooks/useTermAttendees";
import { formatChildAges } from "../../utils/age";
import dayjs from "../../utils/dayjs";
import { pluralPl } from "../../utils/plural";
import { dayMonth, formatPrice, termPublicPath, termTime } from "../../utils/appHelpers";
import { resolveAttendanceView, type AttendanceContentKind } from "./attendanceViewState";

const MUTED = "text-[12.5px] text-ink-soft";

/** Organizer-only list of who signed up for one term (`/terms/:termId/attendees`), a
 * panel view that loads its own data: the hook resolves the group from the
 * term itself. From the term's start the organizer ticks who came and
 * closes the list („Zatwierdź obecność”), which awards the attendance points. */
export function TermAttendeesPage() {
  const { termId = "" } = useAppParams();
  const attendeesRead = useTermAttendees(termId);
  const attendanceRead = useTermAttendance(attendeesRead.term?.group_id, termId);
  const view = resolveAttendanceView({
    term: attendeesRead.term,
    group: attendeesRead.group,
    attendees: attendeesRead.attendees,
    attendance: attendanceRead.attendance,
    denied: attendeesRead.denied || attendanceRead.denied,
    notFound: attendeesRead.notFound || attendanceRead.notFound,
    error: attendeesRead.error ?? attendanceRead.error,
  });

  switch (view.kind) {
    case "denied":
      return <p className={`mt-3 ${MUTED}`}>Nie masz dostępu do tego terminu.</p>;
    case "notFound":
      return <p className={`mt-3 ${MUTED}`}>Nie znaleziono tego terminu.</p>;
    case "error":
      return (
        <div className="mt-3">
          <p className="text-[12.5px] font-semibold text-danger">
            Nie udało się wczytać zapisanych — spróbuj ponownie
          </p>
          <p className="mt-0.5 text-[11.5px] text-ink-soft">{view.message}</p>
          <button
            type="button"
            onClick={() => void Promise.all([attendeesRead.refetch(), attendanceRead.refetch()])}
            className="mt-3 rounded-xl border border-line bg-paper px-4 py-2 text-[13px] font-semibold text-ink transition-colors hover:bg-cream"
          >
            Spróbuj ponownie
          </button>
        </div>
      );
    case "loading":
      return (
        <>
          {view.term && view.group && (
            <>
              <AttendeesHeading term={view.term} group={view.group} />
              <TermHeadCard term={view.term} group={view.group} />
            </>
          )}
          <p className={`mt-4 ${MUTED}`}>Wczytywanie zapisanych…</p>
        </>
      );
    default:
      return (
        <AttendanceContent
          kind={view.kind}
          term={view.term}
          group={view.group}
          attendees={view.attendees}
          attendance={view.attendance}
          onPresence={attendanceRead.setPresence}
          onPayment={attendanceRead.setPaymentStatus}
          onClose={attendanceRead.close}
        />
      );
  }
}

function AttendeesHeading({ term, group }: { term: TermResponse; group: GroupResponse }) {
  const time = termTime(term.occurs_on);
  const parts = [
    dayjs(term.occurs_on).format("ddd, D MMMM"),
    time && `godz. ${time}`,
    group.name,
    term.price != null && formatPrice(term.price),
  ];
  return (
    <>
      <h1 className="font-serif text-[26px] leading-tight font-extrabold tracking-tight text-ink">
        Zapisani na termin
      </h1>
      <p className={`mt-0.5 ${MUTED}`}>{parts.filter(Boolean).join(" · ")}</p>
    </>
  );
}

interface AttendanceContentProps {
  kind: AttendanceContentKind;
  term: TermResponse;
  group: GroupResponse;
  attendees: TermAttendeeResponse[];
  attendance: TermAttendanceResponse;
  onPresence: (partyId: string, present: boolean) => Promise<void>;
  onPayment: (partyId: string, paid: boolean) => Promise<void>;
  onClose: () => Promise<void>;
}

function AttendanceContent({
  kind,
  term,
  group,
  attendees,
  attendance,
  onPresence,
  onPayment,
  onClose,
}: AttendanceContentProps) {
  const [confirming, setConfirming] = useState(false);
  const [presenceError, setPresenceError] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  // Withdrawn PAID rows stay listed for the refund but count toward nothing.
  const counted = attendees.filter((a) => a.counted);
  const childTotal = counted.reduce((sum, a) => sum + a.child_count, 0);
  const countable = counted.filter((a) => !a.is_organizer).length;
  const priced = term.price != null;
  const paidCount = counted.filter((a) => a.payment_status === "PAID").length;
  const open = kind === "open";

  async function togglePresence(partyId: string, present: boolean) {
    setPresenceError(null);
    try {
      await onPresence(partyId, present);
    } catch (err) {
      setPresenceError(err instanceof Error ? err.message : "Nie udało się zapisać obecności");
    }
  }

  async function togglePayment(partyId: string, paid: boolean) {
    setPaymentError(null);
    try {
      await onPayment(partyId, paid);
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : "Nie udało się zapisać płatności");
    }
  }

  return (
    <>
      <AttendeesHeading term={term} group={group} />
      <p className={`mt-0.5 ${MUTED}`}>
        {counted.length === 0
          ? "Brak zapisów"
          : `${counted.length} ${pluralPl(counted.length, "zapis", "zapisy", "zapisów")} · ${childTotal} ${pluralPl(childTotal, "dziecko", "dzieci", "dzieci")}${priced ? ` · opłaceni: ${paidCount}` : ""}`}
      </p>
      <TermHeadCard term={term} group={group} />
      <AttendanceBanner kind={kind} attendance={attendance} countable={countable} />
      {attendees.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-line p-[15px] text-[12.5px] text-ink-soft">
          Nikt jeszcze nie zapisał się na ten termin.
        </p>
      ) : (
        <div className="mt-4 rounded-[22px] border border-line bg-paper p-5">
          <ul>
            {attendees.map((a) => (
              <TermAttendeeRow
                key={a.party_id}
                attendee={a}
                editable={open}
                priced={priced}
                onToggle={(present) => togglePresence(a.party_id, present)}
                onPayment={(paid) => togglePayment(a.party_id, paid)}
              />
            ))}
          </ul>
        </div>
      )}
      {presenceError && (
        <p role="alert" className="mt-2 text-[12.5px] font-semibold text-danger">
          {presenceError}
        </p>
      )}
      {paymentError && (
        <p role="alert" className="mt-2 text-[12.5px] font-semibold text-danger">
          {paymentError}
        </p>
      )}
      {open && (
        <>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="mt-4 min-h-[44px] w-full rounded-[13px] bg-mint px-4 py-[11px] text-[13.5px] font-extrabold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            Zatwierdź obecność
          </button>
          {attendance.auto_close_on && (
            <p className={`mt-2 text-center ${MUTED}`}>
              {`Bez zatwierdzenia lista zamknie się automatycznie ${dayjs(attendance.auto_close_on).format("D MMMM")}.`}
            </p>
          )}
        </>
      )}
      {confirming && (
        <ConfirmDeleteDialog
          title="Zatwierdzić obecność?"
          body={closeDialogBody(attendance)}
          confirmLabel="Zatwierdź"
          busyLabel="Zatwierdzanie…"
          fallbackError="Nie udało się zatwierdzić obecności — spróbuj ponownie"
          tone="primary"
          onConfirm={async () => {
            await onClose();
            setConfirming(false);
          }}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  );
}

function closeDialogBody(attendance: TermAttendanceResponse): string {
  const { attendance_points: level, min_present: min, present_count: present } = attendance;
  const belowMin =
    level > 0 && present < min
      ? ` Za mało obecnych (${present} z min. ${min}) — punkty nie zostaną naliczone.`
      : "";
  return `Obecnych: ${present}.${belowMin} Po zatwierdzeniu nie zmienisz już listy obecnych ani punktów za obecność.`;
}

function bannerText(
  kind: AttendanceContentKind,
  attendance: TermAttendanceResponse,
  countable: number,
): string {
  const { attendance_points: level, min_present: min, present_count: present } = attendance;
  switch (kind) {
    case "closedRewarded":
      return `Obecność zatwierdzona ${dayjs.utc(attendance.closed_at).local().format("D MMMM")}. Obecnych: ${present}. Każda z tych osób otrzymała do ${level} pkt (w granicach miesięcznego limitu).`;
    case "closedBelowMin":
      return `Obecność zatwierdzona. Za mało obecnych osób (${present} z min. ${min}), punkty nie zostały naliczone.`;
    case "closedNoPoints":
      return "Lista obecności zamknięta.";
    default: {
      const rule =
        level === 0
          ? "Ten termin nie daje punktów za obecność."
          : `Ten termin daje ${level} pkt za obecność. Punkty naliczą się, gdy obecne będą min. ${min} ${pluralPl(min, "osoba", "osoby", "osób")}.`;
      return kind === "notStarted"
        ? `${rule} Obecność zaznaczysz od rozpoczęcia terminu.`
        : `${rule} Teraz: ${present} z ${countable}.`;
    }
  }
}

interface AttendanceBannerProps {
  kind: AttendanceContentKind;
  attendance: TermAttendanceResponse;
  /** Attendees who can count toward the minimum (organizers left out). */
  countable: number;
}

function AttendanceBanner({ kind, attendance, countable }: AttendanceBannerProps) {
  const tone = kind === "closedRewarded" ? "bg-mint-soft text-mint" : "bg-lime-soft text-accent-fg";
  return (
    <p className={`mt-3 rounded-[14px] px-[13px] py-2.5 text-[12.5px] font-semibold ${tone}`}>
      {bannerText(kind, attendance, countable)}
    </p>
  );
}

function TermHeadCard({ term, group }: { term: TermResponse; group: GroupResponse }) {
  const { day, month } = dayMonth(term.occurs_on);
  const time = termTime(term.occurs_on);
  const { open, busy, error } = useOpenAndNavigate();

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
      <button
        type="button"
        disabled={busy}
        onClick={() => void open({ kind: "TERM", id: term.id })}
        className="mt-3 min-h-[44px] w-full rounded-[13px] bg-mint px-4 py-[11px] text-[13.5px] font-extrabold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-60"
      >
        <span aria-hidden="true">💬</span> Napisz do uczestników
      </button>
      {error && (
        <p role="alert" className="mt-1.5 text-xs font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function attendancePill(childCount: number): string {
  if (childCount === 0) return "przychodzi bez dzieci";
  if (childCount === 1) return "przychodzi z 1 dzieckiem";
  return `przychodzi z ${childCount} dzieci`;
}

interface TermAttendeeRowProps {
  attendee: TermAttendeeResponse;
  /** Only while the attendance is open. */
  editable: boolean;
  /** The term has a price, so every row gets the payment switch. */
  priced: boolean;
  onToggle: (present: boolean) => Promise<void>;
  onPayment: (paid: boolean) => Promise<void>;
}

function TermAttendeeRow({ attendee, editable, priced, onToggle, onPayment }: TermAttendeeRowProps) {
  const ages = formatChildAges(attendee.children.map((c) => c.birth_year));
  const isPaid = attendee.payment_status === "PAID";
  const refundDue = attendee.withdrawn && isPaid;
  const pillClass =
    attendee.child_count === 0 || refundDue
      ? "border border-line bg-cream text-ink-soft"
      : "bg-mint-soft text-[#12604D]";
  const boxId = `presence-${attendee.party_id}`;
  // The values being saved, shown until the refreshed list arrives.
  const [pending, setPending] = useState<boolean | null>(null);
  const [pendingPaid, setPendingPaid] = useState<boolean | null>(null);
  const checked = pending ?? attendee.present;
  const paid = pendingPaid ?? isPaid;

  async function toggle(present: boolean) {
    setPending(present);
    try {
      await onToggle(present);
    } finally {
      setPending(null);
    }
  }

  async function togglePaid() {
    const next = !paid;
    setPendingPaid(next);
    try {
      await onPayment(next);
    } finally {
      setPendingPaid(null);
    }
  }

  return (
    <li className="mt-2.5 flex items-start gap-3 rounded-2xl border border-line bg-cream p-[15px] first:mt-0">
      <input
        id={boxId}
        type="checkbox"
        checked={checked}
        disabled={!editable || attendee.withdrawn || pending !== null}
        onChange={(e) => void toggle(e.target.checked)}
        aria-describedby={attendee.is_organizer ? `${boxId}-organizer` : undefined}
        className="mt-1 h-6 w-6 flex-none accent-mint disabled:opacity-60"
      />
      <div className="min-w-0 flex-1">
        <label htmlFor={boxId} className="block text-[15.5px] font-bold text-ink">
          {attendee.display_name}
        </label>
        {attendee.family_name && <p className={MUTED}>{attendee.family_name}</p>}
        {attendee.is_organizer && (
          <p id={`${boxId}-organizer`} className={MUTED}>
            organizator — nie dostaje punktów i nie liczy się do minimum
          </p>
        )}
        <span
          className={`mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-[10.5px] font-extrabold ${pillClass}`}
        >
          {refundDue ? "wypisany — do zwrotu" : attendancePill(attendee.child_count)}
        </span>
        {refundDue && (
          <p className={`mt-1.5 ${MUTED}`}>Wypisany po opłaceniu. Odznacz „opłacone” po zwrocie pieniędzy.</p>
        )}
        <p className={`mt-1.5 ${MUTED}`}>
          {ages ? `dzieci w rodzinie: ${ages}` : "brak dzieci w profilu rodziny"}
        </p>
      </div>
      {(checked || priced || isPaid) && (
        <div className="flex flex-none flex-col items-end gap-2">
          {checked && <span className="text-[12px] font-bold text-mint">obecny</span>}
          {(priced || isPaid) && (
            <span className="flex items-center gap-1.5 text-[12.5px] font-bold text-ink">
              <Switch
                checked={paid}
                label={`opłacone — ${attendee.display_name}`}
                disabled={pendingPaid !== null}
                onChange={() => void togglePaid()}
              />
              <span aria-hidden="true">opłacone</span>
            </span>
          )}
        </div>
      )}
    </li>
  );
}
