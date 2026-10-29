import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAppData } from "../../app/appDataStore";
import { SubPageHeader } from "../../components/shared/appComponents";
import { useEvent } from "../../hooks/useEvent";
import { eventPath } from "../../utils/appHelpers";
import { draftFromEvent, toCreateEventRequest } from "../add/eventDraft";
import { EventForm } from "../add/EventForm";

const TITLE = "Edytuj wydarzenie";

/** `/events/:eventId/edit`: the author changes the event's fields (the
 * banner stays as it is). The draft is seeded once per event and lives in
 * AppDataContext, so a trip to /places/new from the place picker keeps it;
 * after saving, back to the event page. */
export function EventEditView() {
  const { eventId = "" } = useParams();
  const navigate = useNavigate();
  const { eventEdit, setEventEdit } = useAppData();
  const { data: event, loading, update } = useEvent(eventId);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = event !== null && event.is_author;
  const draft = eventEdit?.eventId === eventId ? eventEdit.draft : null;

  useEffect(() => {
    if (editable && eventEdit?.eventId !== eventId) setEventEdit({ eventId, draft: draftFromEvent(event) });
  }, [editable, event, eventEdit, eventId, setEventEdit]);

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await update(toCreateEventRequest(draft));
    } catch (err) {
      setError(err instanceof Error ? err.message : null);
      setBusy(false);
      return;
    }
    setEventEdit(null);
    navigate(eventPath(eventId));
  }

  return (
    <section aria-label={TITLE}>
      <SubPageHeader title={TITLE} backTo={eventPath(eventId)} backLabel="Wróć do wydarzenia" />
      {loading ? (
        <p className="text-[12.5px] text-ink-soft">Wczytywanie wydarzenia…</p>
      ) : !editable ? (
        <p className="rounded-[22px] border border-line bg-paper p-5 text-sm text-ink-soft">
          Nie znaleziono tego wydarzenia wśród Twoich wydarzeń.
        </p>
      ) : (
        draft && (
          <EventForm
            draft={draft}
            onDraftChange={(next) => setEventEdit({ eventId, draft: next })}
            savedStart={event.starts_at}
            placeIdPrefix="edit-event-place"
            submitLabel="Zapisz zmiany"
            showErrors={showErrors}
            onInvalidSubmit={() => setShowErrors(true)}
            busy={busy}
            error={error}
            onSubmit={() => void save()}
          />
        )
      )}
    </section>
  );
}
