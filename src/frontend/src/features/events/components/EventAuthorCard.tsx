import { useState } from "react";
import { Link } from "../../../routing/navigation";
import type { EventDetailResponse } from "../../../api/events";
import { ConfirmDeleteDialog } from "../../../components/shared/ConfirmDeleteDialog";
import { CARD } from "../../../components/shared/uiStyles";
import { eventEditPath } from "../../../routing/paths";
import dayjs from "../../../utils/dayjs";
import { pluralPl } from "../../../utils/plural";

const ACTION_BUTTON =
  "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full border-[1.5px] border-line bg-paper px-4 text-[13.5px] font-extrabold hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const DELETE_HINT_ID = "event-delete-hint";

function openReservationsWarning(total: number, swaps: number): string {
  const verb = pluralPl(total, "jest", "są", "jest");
  const reservations = pluralPl(total, "otwarta rezerwacja", "otwarte rezerwacje", "otwartych rezerwacji");
  const swapNote = swaps > 0 ? ` (w tym ${swaps} ${pluralPl(swaps, "zamiana", "zamiany", "zamian")})` : "";
  return (
    `Na tym wydarzeniu ${verb} ${total} ${reservations}${swapNote}. ` +
    "Usunięcie je anuluje — rzeczy wrócą do właścicieli, a obie strony dostaną powiadomienie."
  );
}

/** "Twoje wydarzenie": edit, and delete while nobody is signed up and, once the
 * event has started, no reservation is open (a blocked delete stays focusable
 * and explains why). Before the start, deleting cancels open reservations. */
export function EventAuthorCard({
  event,
  onDelete,
}: {
  event: EventDetailResponse;
  /** Rejects with the message the confirm dialog shows. */
  onDelete: () => Promise<void>;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const openReservations = event.open_reservations?.total ?? 0;
  const hasAttendees = event.attendee_count > 0;
  // `starts_at` is naive Warsaw wall-clock, compared as browser-local time.
  const startedWithReservations = openReservations > 0 && !dayjs().isBefore(dayjs(event.starts_at));
  const deleteBlocked = hasAttendees || startedWithReservations;

  return (
    <section aria-labelledby="event-author-heading" className={`${CARD} mx-5 mt-6`}>
      <h2 id="event-author-heading" className="text-xs font-extrabold tracking-[.12em] text-ink-soft uppercase">
        Twoje wydarzenie
      </h2>
      <p className="mt-1.5 text-sm text-ink-soft">
        Możesz je edytować. Usunąć da się dopiero, gdy nikt nie jest zapisany.
      </p>
      <div className="mt-3 flex gap-2">
        <Link to={eventEditPath(event.id)} className={`${ACTION_BUTTON} text-ink`}>
          <span aria-hidden="true">✏️</span> Edytuj
        </Link>
        <button
          type="button"
          aria-disabled={deleteBlocked || undefined}
          aria-describedby={deleteBlocked ? DELETE_HINT_ID : undefined}
          aria-haspopup="dialog"
          onClick={(e) => {
            if (deleteBlocked) return;
            // Safari does not focus a clicked button; the dialog returns focus to it.
            e.currentTarget.focus();
            setConfirmingDelete(true);
          }}
          className={`${ACTION_BUTTON} text-danger aria-disabled:cursor-not-allowed aria-disabled:opacity-60`}
        >
          Usuń
        </button>
      </div>
      {hasAttendees ? (
        <p id={DELETE_HINT_ID} className="mt-2 text-xs text-ink-soft">
          Nie można usunąć — {pluralPl(event.attendee_count, "zapisała", "zapisały", "zapisało")} się już{" "}
          {event.attendee_count} {pluralPl(event.attendee_count, "osoba", "osoby", "osób")}.
        </p>
      ) : (
        startedWithReservations && (
          <p id={DELETE_HINT_ID} className="mt-2 text-xs text-ink-soft">
            Nie można usunąć — wydarzenie się rozpoczęło i ma otwarte rezerwacje
          </p>
        )
      )}

      {confirmingDelete && (
        <ConfirmDeleteDialog
          title="Usunąć wydarzenie?"
          body={
            openReservations > 0
              ? openReservationsWarning(openReservations, event.open_reservations?.swaps ?? 0)
              : `„${event.name}” zniknie razem z banerem. Tej operacji nie można cofnąć.`
          }
          confirmLabel={openReservations > 0 ? "Usuń i anuluj rezerwacje" : "Usuń wydarzenie"}
          fallbackError="Nie udało się usunąć wydarzenia. Spróbuj ponownie."
          onConfirm={onDelete}
          onClose={() => setConfirmingDelete(false)}
        />
      )}
    </section>
  );
}
