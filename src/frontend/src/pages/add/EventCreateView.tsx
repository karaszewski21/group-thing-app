import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { EventResponse } from "../../api/events";
import { useAppData } from "../../app/appDataStore";
import { INPUT_CLASS, SubPageHeader } from "../../components/shared/appComponents";
import { LocationPicker } from "../../components/shared/LocationPicker";
import { useCreateEvent } from "../../hooks/useCreateEvent";
import { viewPath } from "../../utils/appHelpers";
import dayjs from "../../utils/dayjs";
import { PhotoFileField } from "../product/ItemGalleryEditor";
import {
  EMPTY_EVENT_DRAFT,
  EVENT_DESCRIPTION_MAX,
  EVENT_NAME_MAX,
  bannerFileError,
  charCount,
  toCreateEventRequest,
  validateEventDraft,
  type EventDraft,
  type EventDraftErrors,
} from "./eventDraft";

const TITLE = "Nowe wydarzenie";
const LABEL_CLASS = "text-xs font-extrabold tracking-wide text-ink-soft";
const ERROR_CLASS = "text-[12.5px] font-semibold text-danger";
const OPTIONAL = <span className="font-semibold normal-case opacity-75"> (opcjonalnie)</span>;
const SUBMIT_HINT_ID = "event-submit-hint";

type Screen = { kind: "form" } | { kind: "bannerFailed"; event: EventResponse; banner: File; detail: string };

function savedToast(event: EventResponse): string {
  return `Wydarzenie „${event.name}” zapisane`;
}

/** Wires an input to its inline error: `aria-invalid` plus `aria-describedby`. */
function errorProps(message: string | undefined, errorId: string) {
  return message ? { "aria-invalid": true, "aria-describedby": errorId } : {};
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className={ERROR_CLASS}>
      {message}
    </p>
  );
}

/** `/add/event`: a one-off event (picnic, birthday). Saves the event, then its
 * optional banner; back on the /add hub with a toast once both are done. If
 * only the banner fails, the event already exists, so the page offers a retry
 * or skipping the banner instead of the form. */
export function EventCreateView() {
  const { showToast } = useAppData();
  const navigate = useNavigate();
  const { create, uploadBanner } = useCreateEvent();
  const [draft, setDraft] = useState<EventDraft>(EMPTY_EVENT_DRAFT);
  const [banner, setBanner] = useState<File | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ kind: "form" });

  function finish(event: EventResponse) {
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
          banner={banner}
          onBannerChange={setBanner}
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

interface EventFormProps {
  draft: EventDraft;
  onDraftChange: (draft: EventDraft) => void;
  banner: File | null;
  onBannerChange: (file: File | null) => void;
  /** Errors of untouched fields too — set by a submit attempt. */
  showErrors: boolean;
  onInvalidSubmit: () => void;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
}

function EventForm({
  draft,
  onDraftChange,
  banner,
  onBannerChange,
  showErrors,
  onInvalidSubmit,
  busy,
  error,
  onSubmit,
}: EventFormProps) {
  const [touched, setTouched] = useState<Partial<Record<keyof EventDraftErrors, boolean>>>({});
  const errorRef = useRef<HTMLParagraphElement>(null);
  const now = dayjs();
  const today = now.format("YYYY-MM-DD");
  const errors = validateEventDraft(draft, now);
  const invalid = Object.keys(errors).length > 0;
  const visible = (field: keyof EventDraftErrors) => (showErrors || touched[field] ? errors[field] : undefined);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  function set<K extends keyof EventDraft>(key: K, value: EventDraft[K]) {
    onDraftChange({ ...draft, [key]: value });
  }

  function touch(field: keyof EventDraftErrors) {
    setTouched((t) => (t[field] ? t : { ...t, [field]: true }));
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    if (invalid) {
      onInvalidSubmit();
      return;
    }
    onSubmit();
  }

  const nameError = visible("name");
  const startError = visible("start");
  const endError = visible("end");
  const descriptionError = visible("description");

  return (
    <form noValidate onSubmit={submit} className="rounded-[22px] border border-line bg-paper p-5">
      <p className="mb-4 text-[13px] text-ink-soft">Jednorazowe spotkanie, np. piknik, urodziny albo wspólny spacer.</p>
      <div className="grid grid-cols-1 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="event-name" className={LABEL_CLASS}>
            Nazwa
          </label>
          <input
            id="event-name"
            value={draft.name}
            maxLength={EVENT_NAME_MAX}
            placeholder="Np. Piknik w parku"
            {...errorProps(nameError, "event-name-error")}
            onChange={(e) => set("name", e.target.value)}
            onBlur={() => touch("name")}
            className={INPUT_CLASS}
          />
          <FieldError id="event-name-error" message={nameError} />
        </div>

        <div role="group" aria-labelledby="event-start-label" className="flex flex-col gap-1.5">
          <span id="event-start-label" className={LABEL_CLASS}>
            Początek
          </span>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              aria-label="Data początku"
              min={today}
              value={draft.date}
              {...errorProps(startError, "event-start-error")}
              onChange={(e) => set("date", e.target.value)}
              onBlur={() => {
                if (draft.startTime !== "") touch("start");
              }}
              className={`${INPUT_CLASS} min-w-0`}
            />
            <input
              type="time"
              aria-label="Godzina początku"
              value={draft.startTime}
              {...errorProps(startError, "event-start-error")}
              onChange={(e) => set("startTime", e.target.value)}
              onBlur={() => touch("start")}
              className={`${INPUT_CLASS} min-w-0`}
            />
          </div>
          <FieldError id="event-start-error" message={startError} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="event-end" className={LABEL_CLASS}>
            Godzina końca{OPTIONAL}
          </label>
          <input
            id="event-end"
            type="time"
            value={draft.endTime}
            {...errorProps(endError, "event-end-error")}
            onChange={(e) => set("endTime", e.target.value)}
            onBlur={() => touch("end")}
            className={`${INPUT_CLASS} w-1/2 min-w-0`}
          />
          <FieldError id="event-end-error" message={endError} />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className={LABEL_CLASS}>Miejsce{OPTIONAL}</span>
          <LocationPicker
            value={draft.locationId}
            onChange={(id) => set("locationId", id)}
            label="Miejsce"
            noneLabel="Bez miejsca"
            idPrefix="add-event-place"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="event-description" className={LABEL_CLASS}>
            Opis{OPTIONAL}
          </label>
          <textarea
            id="event-description"
            rows={4}
            value={draft.description}
            maxLength={EVENT_DESCRIPTION_MAX}
            placeholder="Co planujecie, co warto zabrać"
            aria-invalid={descriptionError ? true : undefined}
            aria-describedby={
              descriptionError ? "event-description-counter event-description-error" : "event-description-counter"
            }
            onChange={(e) => set("description", e.target.value)}
            onBlur={() => touch("description")}
            className={INPUT_CLASS}
          />
          <p id="event-description-counter" className="text-right text-[11.5px] text-ink-soft">
            {charCount(draft.description)} / {EVENT_DESCRIPTION_MAX}
          </p>
          <FieldError id="event-description-error" message={descriptionError} />
        </div>

        <BannerField value={banner} onChange={onBannerChange} disabled={busy} />
      </div>

      {error && (
        <p
          ref={errorRef}
          role="alert"
          tabIndex={-1}
          className="mt-3 rounded-xl bg-danger-soft px-3 py-2.5 text-[13px] text-danger"
        >
          {error}
        </p>
      )}
      {/* Invalid input keeps the button focusable (aria-disabled) so the hint reaches
          keyboard and screen-reader users; only a running save disables it natively. */}
      <button
        type="submit"
        disabled={busy}
        aria-disabled={!busy && invalid ? true : undefined}
        aria-describedby={invalid ? SUBMIT_HINT_ID : undefined}
        className="mt-4 w-full rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
      >
        {busy ? "Zapisywanie…" : "Zapisz wydarzenie"}
      </button>
      {invalid && (
        <p id={SUBMIT_HINT_ID} className="mt-2 text-xs text-ink-soft">
          Uzupełnij nazwę oraz datę i godzinę początku, aby zapisać.
        </p>
      )}
    </form>
  );
}

/** Optional banner: a local preview with "Usuń" once chosen. An invalid file
 * is refused here and the previous choice is kept. */
function BannerField({ value, onChange, disabled }: { value: File | null; onChange: (file: File | null) => void; disabled: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const preview = useMemo(() => (value ? URL.createObjectURL(value) : null), [value]);

  useEffect(() => {
    if (preview) return () => URL.revokeObjectURL(preview);
  }, [preview]);

  function pick([file]: File[]) {
    if (!file) return;
    const invalid = bannerFileError(file);
    setError(invalid);
    if (!invalid) onChange(file);
  }

  return (
    <section aria-labelledby="event-banner-heading" className="flex flex-col gap-1.5">
      <h2 id="event-banner-heading" className={LABEL_CLASS}>
        Baner{OPTIONAL}
      </h2>
      {value && (
        <div className="flex items-center gap-2 rounded-2xl border border-line bg-cream p-2">
          {preview && <img src={preview} alt="Podgląd banera" className="h-14 w-24 flex-none rounded-xl object-cover" />}
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink" title={value.name}>
            {value.name}
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setError(null);
              onChange(null);
            }}
            className="rounded-[9px] px-2.5 py-1.5 text-xs font-bold text-danger disabled:opacity-40"
          >
            Usuń{" "}
            <span className="sr-only">baner</span>
          </button>
        </div>
      )}
      <PhotoFileField
        disabled={disabled}
        label={value ? "Zmień baner" : "+ Dodaj baner"}
        multiple={false}
        className="self-start"
        onFiles={pick}
      />
      <p className="text-[11.5px] text-ink-soft">JPG, PNG lub WebP, do 5 MB</p>
      {error && (
        <p role="alert" className={ERROR_CLASS}>
          {error}
        </p>
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
