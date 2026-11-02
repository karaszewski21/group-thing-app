import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { INPUT_CLASS } from "../../components/shared/appComponents";
import { LocationPicker } from "../../components/shared/LocationPicker";
import { PhotoGalleryField } from "../../components/shared/PhotoGalleryField";
import dayjs from "../../utils/dayjs";
import {
  EVENT_DESCRIPTION_MAX,
  EVENT_NAME_MAX,
  bannerFileError,
  charCount,
  validateEventDraft,
  type EventDraft,
  type EventDraftErrors,
} from "./eventDraft";

const LABEL_CLASS = "text-xs font-extrabold tracking-wide text-ink-soft";
const ERROR_CLASS = "text-[12.5px] font-semibold text-danger";
const OPTIONAL = <span className="font-semibold normal-case opacity-75"> (opcjonalnie)</span>;
const SUBMIT_HINT_ID = "event-submit-hint";

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

interface EventFormProps {
  draft: EventDraft;
  onDraftChange: (draft: EventDraft) => void;
  /** The optional banner picker; left out on the edit page. */
  banner?: { value: File | null; onChange: (file: File | null) => void };
  /** An edited event's `starts_at`, kept valid even once it has passed. */
  savedStart?: string;
  placeIdPrefix: string;
  submitLabel: string;
  /** Errors of untouched fields too — set by a submit attempt. */
  showErrors: boolean;
  onInvalidSubmit: () => void;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
}

/** The event fields shared by `/add/event` and `/events/:id/edit`; inline
 * errors show once a field is touched or a submit was attempted. */
export function EventForm({
  draft,
  onDraftChange,
  banner,
  savedStart,
  placeIdPrefix,
  submitLabel,
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
  const errors = validateEventDraft(draft, now, savedStart);
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
      <div className="grid grid-cols-1 gap-3">
        {banner && <BannerField value={banner.value} onChange={banner.onChange} disabled={busy} />}
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
              min={savedStart && savedStart.slice(0, 10) < today ? undefined : today}
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
            idPrefix={placeIdPrefix}
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
        {busy ? "Zapisywanie…" : submitLabel}
      </button>
      {invalid && (
        <p id={SUBMIT_HINT_ID} className="mt-2 text-xs text-ink-soft">
          Uzupełnij nazwę oraz datę i godzinę początku, aby zapisać.
        </p>
      )}
    </form>
  );
}

/** Optional banner in the shared photo slider (a single wide photo). An
 * invalid file is refused here and the previous choice is kept. */
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
      <PhotoGalleryField
        photos={preview ? [{ id: preview, src: preview }] : []}
        max={1}
        disabled={disabled}
        onFiles={pick}
        onRemove={() => {
          setError(null);
          onChange(null);
        }}
        noun="baner"
        addLabel="Dodaj baner"
        variant="create"
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
