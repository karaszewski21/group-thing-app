import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { EventDetailResponse } from "../../api/events";
import { useAuth } from "../../auth/AuthContext";
import { AddToCalendarButton } from "../../components/shared/AddToCalendarButton";
import { BackIcon, CopyIcon, PencilIcon, TrashIcon } from "../../components/shared/appIcons";
import { ConfirmDeleteDialog } from "../../components/shared/ConfirmDeleteDialog";
import { PhoneFrame } from "../../components/shared/PhoneFrame";
import { TermPlaceLine } from "../../components/shared/TermPlaceLine";
import { ToastPill } from "../../components/shared/ToastPill";
import { useToast } from "../../components/shared/useToast";
import { useEvent } from "../../hooks/useEvent";
import { eventEditPath, eventPath, termTime, viewPath } from "../../utils/appHelpers";
import dayjs from "../../utils/dayjs";
import { pluralPl } from "../../utils/plural";
import { resolveEventView } from "./eventViewState";

const ACTION_BUTTON =
  "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-[13px] border-[1.5px] border-line bg-paper px-4 text-[13.5px] font-extrabold text-ink hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const DELETE_HINT_ID = "event-delete-hint";

/** Route element for `/events/:eventId`: the public page of a one-off event.
 * Anyone may read it; its author also gets edit and delete. */
export function EventPage() {
  const { eventId = "" } = useParams();
  const { token } = useAuth();
  const navigate = useNavigate();
  const { data, loading, notFound, error, refetch, remove } = useEvent(eventId);
  const { toast, showToast } = useToast();
  const view = resolveEventView({ data, loading, notFound, error });

  return (
    <PhoneFrame>
      <main tabIndex={-1} className="flex-1 overflow-y-auto px-4.5 pt-4.5 pb-6 outline-none">
        {token && (
          <Link to={viewPath("meetings")} className="mb-4 inline-flex items-center gap-1.5 text-xs font-bold text-ink-soft">
            <BackIcon /> Spotkania
          </Link>
        )}
        {(() => {
          switch (view.kind) {
            case "loading":
              return <p className="text-[12.5px] text-ink-soft">Wczytywanie wydarzenia…</p>;
            case "notFound":
              return <p className="text-[12.5px] text-ink-soft">Nie znaleziono wydarzenia.</p>;
            case "error":
              return (
                <div>
                  <p role="alert" className="text-[12.5px] font-semibold text-danger">
                    Nie udało się wczytać wydarzenia — {view.message}
                  </p>
                  <button
                    type="button"
                    onClick={() => void refetch()}
                    className="mt-3 rounded-xl border border-line bg-paper px-4 py-2 text-[13px] font-semibold text-ink hover:bg-cream"
                  >
                    Spróbuj ponownie
                  </button>
                </div>
              );
            case "content":
              return (
                <EventView
                  event={view.event}
                  onCopied={() => showToast("Skopiowano link")}
                  onDelete={async () => {
                    await remove();
                    navigate(viewPath("meetings"));
                  }}
                />
              );
          }
        })()}
      </main>
      <ToastPill message={toast} />
    </PhoneFrame>
  );
}

interface EventViewProps {
  event: EventDetailResponse;
  onCopied: () => void;
  /** Rejects with the message the confirm dialog shows. */
  onDelete: () => Promise<void>;
}

function EventView({ event, onCopied, onDelete }: EventViewProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const url = `${window.location.origin}${eventPath(event.id)}`;
  const start = termTime(event.starts_at);
  const end = event.ends_at ? termTime(event.ends_at) : "";
  const deleteBlocked = event.attendee_count > 0;

  return (
    <article>
      {event.banner_url && (
        <img
          src={event.banner_url}
          alt={`Baner wydarzenia ${event.name}`}
          className="mb-4 aspect-16/7 w-full rounded-[22px] object-cover"
        />
      )}
      <span className="inline-block rounded-full bg-accent-soft px-2.5 py-0.5 text-[11px] font-extrabold text-accent-fg">
        Wydarzenie
      </span>
      <h1 className="mt-1.5 font-serif text-[26px] leading-tight font-extrabold tracking-tight wrap-break-word text-ink">
        {event.name}
      </h1>
      <p className="mt-1.5 text-[15px] font-bold text-ink">
        {dayjs(event.starts_at).format("dddd, D MMMM YYYY")}
        {start && `, godz. ${start}${end ? `–${end}` : ""}`}
      </p>
      <TermPlaceLine location={event.location} capacity={null} withMapLink className="mt-2" />
      {event.description && (
        <p className="mt-4 text-[14px] whitespace-pre-line wrap-break-word text-ink">{event.description}</p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <AddToCalendarButton
          event={{
            uid: event.id,
            title: event.name,
            occursOn: event.starts_at,
            groupName: event.location?.name ?? event.name,
            url,
          }}
          size="sm"
          direction="down"
        />
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(url);
            onCopied();
          }}
          className="flex min-h-10 items-center gap-1.5 rounded-full border-[1.5px] border-line bg-paper px-3.5 text-sm font-bold text-ink hover:border-line-strong"
        >
          <CopyIcon /> Kopiuj link
        </button>
      </div>

      {event.is_author && (
        <section aria-labelledby="event-author-heading" className="mt-6 rounded-[22px] border border-line bg-paper p-4">
          <h2 id="event-author-heading" className="font-serif text-[17px] font-bold text-ink">
            Twoje wydarzenie
          </h2>
          <div className="mt-3 flex gap-2">
            <Link to={eventEditPath(event.id)} className={ACTION_BUTTON}>
              <PencilIcon /> Edytuj
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
              <TrashIcon /> Usuń
            </button>
          </div>
          {deleteBlocked && (
            <p id={DELETE_HINT_ID} className="mt-2 text-xs text-ink-soft">
              Nie można usunąć — zapisał{event.attendee_count === 1 ? "a" : "o"} się już {event.attendee_count}{" "}
              {pluralPl(event.attendee_count, "osoba", "osoby", "osób")}.
            </p>
          )}
        </section>
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
    </article>
  );
}
