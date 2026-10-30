import { useState } from "react";
import { Link } from "react-router-dom";
import type { EventDetailResponse } from "../../../api/events";
import { ConfirmDeleteDialog } from "../../../components/shared/ConfirmDeleteDialog";
import { CARD } from "../../../components/shared/uiStyles";
import { eventEditPath } from "../../../utils/appHelpers";
import { pluralPl } from "../../../utils/plural";

const ACTION_BUTTON =
  "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full border-[1.5px] border-line bg-paper px-4 text-[13.5px] font-extrabold hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const DELETE_HINT_ID = "event-delete-hint";

/** "Twoje wydarzenie": edit, and delete while nobody is signed up (a blocked
 * delete stays focusable and explains why). */
export function EventAuthorCard({
  event,
  onDelete,
}: {
  event: EventDetailResponse;
  /** Rejects with the message the confirm dialog shows. */
  onDelete: () => Promise<void>;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const deleteBlocked = event.attendee_count > 0;

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
      {deleteBlocked && (
        <p id={DELETE_HINT_ID} className="mt-2 text-xs text-ink-soft">
          Nie można usunąć — {pluralPl(event.attendee_count, "zapisała", "zapisały", "zapisało")} się już{" "}
          {event.attendee_count} {pluralPl(event.attendee_count, "osoba", "osoby", "osób")}.
        </p>
      )}

      {confirmingDelete && (
        <ConfirmDeleteDialog
          title="Usunąć wydarzenie?"
          body={`„${event.name}” zniknie razem z banerem. Tej operacji nie można cofnąć.`}
          confirmLabel="Usuń wydarzenie"
          fallbackError="Nie udało się usunąć wydarzenia. Spróbuj ponownie."
          onConfirm={onDelete}
          onClose={() => setConfirmingDelete(false)}
        />
      )}
    </section>
  );
}
