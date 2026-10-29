import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { EventResponse } from "../../api/events";
import { useAppData } from "../../app/appDataStore";
import { SubPageHeader } from "../../components/shared/appComponents";
import { useCreateEvent } from "../../hooks/useCreateEvent";
import { viewPath } from "../../utils/appHelpers";
import { EMPTY_EVENT_DRAFT, toCreateEventRequest } from "./eventDraft";
import { EventForm } from "./EventForm";

const TITLE = "Nowe wydarzenie";
type Screen = { kind: "form" } | { kind: "bannerFailed"; event: EventResponse; banner: File; detail: string };

function savedToast(event: EventResponse): string {
  return `Wydarzenie „${event.name}” zapisane`;
}

/** `/add/event`: a one-off event (picnic, birthday). Saves the event, then its
 * optional banner; back on the /add hub with a toast once both are done. If
 * only the banner fails, the event already exists, so the page offers a retry
 * or skipping the banner instead of the form. */
export function EventCreateView() {
  const { showToast, eventDraft: draft, setEventDraft: setDraft, eventBanner: banner, setEventBanner: setBanner } =
    useAppData();
  const navigate = useNavigate();
  const { create, uploadBanner } = useCreateEvent();
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ kind: "form" });

  function finish(event: EventResponse) {
    setDraft(EMPTY_EVENT_DRAFT);
    setBanner(null);
    showToast(savedToast(event));
    navigate(viewPath("add"));
  }

  /** Also the retry: a new upload replaces any banner already stored. */
  async function sendBanner(event: EventResponse, file: File) {
    setBusy(true);
    try {
      await uploadBanner(event.id, file);
      finish(event);
    } catch (err) {
      setBusy(false);
      setScreen({ kind: "bannerFailed", event, banner: file, detail: err instanceof Error ? err.message : "" });
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    let event: EventResponse;
    try {
      event = await create(toCreateEventRequest(draft));
    } catch (err) {
      setError(err instanceof Error ? err.message : null);
      setBusy(false);
      return;
    }
    if (banner) await sendBanner(event, banner);
    else finish(event);
  }

  return (
    <section aria-label={TITLE}>
      <SubPageHeader title={TITLE} backTo={viewPath("add")} backLabel="Wróć do dodawania" />
      {screen.kind === "bannerFailed" ? (
        <BannerFailed
          event={screen.event}
          detail={screen.detail}
          busy={busy}
          onRetry={() => void sendBanner(screen.event, screen.banner)}
          onSkip={() => finish(screen.event)}
        />
      ) : (
        <EventForm
          draft={draft}
          onDraftChange={setDraft}
          banner={{ value: banner, onChange: setBanner }}
          placeIdPrefix="add-event-place"
          submitLabel="Zapisz wydarzenie"
          showErrors={showErrors}
          onInvalidSubmit={() => setShowErrors(true)}
          busy={busy}
          error={error}
          onSubmit={() => void save()}
        />
      )}
    </section>
  );
}

interface BannerFailedProps {
  event: EventResponse;
  detail: string;
  busy: boolean;
  onRetry: () => void;
  onSkip: () => void;
}

/** The event is saved, only its banner upload failed. */
function BannerFailed({ event, detail, busy, onRetry, onSkip }: BannerFailedProps) {
  const retryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    retryRef.current?.focus();
  }, []);

  return (
    <div className="rounded-[22px] border border-line bg-paper p-5">
      <p className="font-serif text-lg font-extrabold text-ink">{event.name}</p>
      <div role="alert" className="mt-3 rounded-xl bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
        <p>Nie udało się wysłać banera. Wydarzenie jest zapisane bez banera.</p>
        {detail && <p>{detail}</p>}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          ref={retryRef}
          type="button"
          disabled={busy}
          onClick={onRetry}
          className="rounded-[13px] bg-mint px-4 py-3 text-[13.5px] font-extrabold text-white disabled:opacity-60"
        >
          {busy ? "Wysyłanie…" : "Spróbuj ponownie"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onSkip}
          className="rounded-[13px] border-[1.5px] border-line-strong px-4 py-3 text-[13.5px] font-extrabold text-ink disabled:opacity-60"
        >
          Pomiń baner
        </button>
      </div>
    </div>
  );
}
