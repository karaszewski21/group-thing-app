import { useEffect, useRef, useState, type FormEvent } from "react";
import { getSDK } from "../../../sdk";
import { BannerFailed } from "../components/BannerFailed";
import { BannerPicker } from "../components/BannerPicker";
import { LocationField } from "../components/LocationField";
import { SavedCard } from "../components/SavedCard";
import { SaveProgress } from "../components/SaveProgress";
import {
  DESCRIPTION_MAX,
  EMPTY_DRAFT,
  MESSAGES,
  NAME_MAX,
  createEvent,
  toRequest,
  uploadBanner,
  validateDraft,
  type EventDraft,
  type EventResponse,
} from "../domain";

type TouchedField = "name" | "start" | "end" | "description";

const UNTOUCHED: Record<TouchedField, boolean> = { name: false, start: false, end: false, description: false };
const ALL_TOUCHED: Record<TouchedField, boolean> = { name: true, start: true, end: true, description: true };
const SUBMIT_HINT_ID = "event-submit-hint";

type SaveState =
  | { kind: "form"; error: string | null }
  | { kind: "saving"; name: string; phase: "creating" | "uploading"; withBanner: boolean }
  | { kind: "bannerFailed"; event: EventResponse; banner: File; detail: string | null }
  | { kind: "saved"; event: EventResponse; bannerUrl: string | null };

const FORM: SaveState = { kind: "form", error: null };

function localDateString(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Wires an input to its inline error: `aria-invalid` plus `aria-describedby`. */
function errorProps(invalid: boolean, errorId: string) {
  return invalid ? { "aria-invalid": true, "aria-describedby": errorId } : {};
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} className="err" role="alert">
      {message}
    </p>
  );
}

export function EventCreatePage() {
  const [draft, setDraft] = useState<EventDraft>(EMPTY_DRAFT);
  const [touched, setTouched] = useState(UNTOUCHED);
  const [save, setSave] = useState<SaveState>(FORM);
  const leadRef = useRef<HTMLParagraphElement>(null);
  const createErrorRef = useRef<HTMLParagraphElement>(null);
  // Set by "Dodaj kolejne": the button that had focus unmounts with the confirmation.
  const focusLead = useRef(false);

  const createError = save.kind === "form" ? save.error : null;

  useEffect(() => {
    if (save.kind !== "form") return;
    if (createError) {
      createErrorRef.current?.focus();
    } else if (focusLead.current) {
      focusLead.current = false;
      leadRef.current?.focus();
    }
  }, [save.kind, createError]);

  const now = new Date();
  const today = localDateString(now);
  const errors = validateDraft(draft, now);
  const invalid = Object.keys(errors).length > 0;

  const nameError = touched.name ? errors.name : undefined;
  const startError = touched.start ? errors.start : undefined;
  const endError = touched.end ? errors.end : undefined;
  const descriptionError = touched.description ? errors.description : undefined;

  // A missing start marks the empty input(s); a past start today points at the time, otherwise at the date.
  const startMissing = startError === MESSAGES.startMissing;
  const dateInvalid = startMissing ? draft.date === "" : !!startError && !(startError === MESSAGES.startPast && draft.date === today);
  const timeInvalid = startMissing ? draft.startTime === "" : startError === MESSAGES.startPast && draft.date === today;

  function set<K extends keyof EventDraft>(key: K, value: EventDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function touch(field: TouchedField) {
    setTouched((t) => (t[field] ? t : { ...t, [field]: true }));
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (invalid) {
      setTouched(ALL_TOUCHED);
      return;
    }
    void saveDraft(draft);
  }

  async function saveDraft(current: EventDraft) {
    const request = toRequest(current);
    setSave({ kind: "saving", name: request.name, phase: "creating", withBanner: current.banner !== null });
    const created = await createEvent(request);
    if (!created.ok) {
      setSave({ kind: "form", error: created.error });
      return;
    }
    if (current.banner) await sendBanner(created.value, current.banner);
    else setSave({ kind: "saved", event: created.value, bannerUrl: null });
  }

  /** Also the retry: a new upload replaces any banner already stored for the event. */
  async function sendBanner(event: EventResponse, banner: File) {
    setSave({ kind: "saving", name: event.name, phase: "uploading", withBanner: true });
    const uploaded = await uploadBanner(event.id, banner);
    setSave(
      uploaded.ok
        ? { kind: "saved", event, bannerUrl: uploaded.value.url }
        : { kind: "bannerFailed", event, banner, detail: uploaded.error },
    );
  }

  function addAnother() {
    setDraft(EMPTY_DRAFT);
    setTouched(UNTOUCHED);
    focusLead.current = true;
    setSave(FORM);
  }

  switch (save.kind) {
    case "saving":
      return <SaveProgress name={save.name} phase={save.phase} withBanner={save.withBanner} />;
    case "bannerFailed":
      return (
        <BannerFailed
          event={save.event}
          detail={save.detail}
          onRetry={() => void sendBanner(save.event, save.banner)}
          onSkip={() => setSave({ kind: "saved", event: save.event, bannerUrl: null })}
        />
      );
    case "saved":
      return (
        <main>
          <SavedCard event={save.event} bannerUrl={save.bannerUrl} focusOnMount />
          <div className="actions">
            <button type="button" className="btn" onClick={addAnother}>
              Dodaj kolejne
            </button>
            <button type="button" className="ghost" onClick={() => getSDK().thisPlugin.done({ name: save.event.name })}>
              Wróć do dodawania
            </button>
          </div>
        </main>
      );
    case "form":
      break;
  }

  return (
    <main>
      <p ref={leadRef} className="lead" tabIndex={-1}>
        Jednorazowe spotkanie, np. piknik, urodziny albo wspólny spacer.
      </p>

      <form className="form" noValidate onSubmit={submit}>
        <BannerPicker value={draft.banner} onChange={(file) => set("banner", file)} />

        <div>
          <label className="label" htmlFor="event-name">
            Nazwa
          </label>
          <input
            id="event-name"
            className="input"
            value={draft.name}
            maxLength={NAME_MAX}
            placeholder="Np. Piknik w parku"
            {...errorProps(!!nameError, "event-name-error")}
            onChange={(e) => set("name", e.target.value)}
            onBlur={() => touch("name")}
          />
          <FieldError id="event-name-error" message={nameError} />
        </div>

        <div role="group" aria-labelledby="event-start-label">
          <span className="label" id="event-start-label">
            Początek
          </span>
          <div className="grid2">
            <input
              type="date"
              className="input"
              aria-label="Data początku"
              min={today}
              value={draft.date}
              {...errorProps(dateInvalid, "event-start-error")}
              onChange={(e) => set("date", e.target.value)}
              onBlur={() => {
                if (draft.startTime !== "") touch("start");
              }}
            />
            <input
              type="time"
              className="input"
              aria-label="Godzina początku"
              value={draft.startTime}
              {...errorProps(timeInvalid, "event-start-error")}
              onChange={(e) => set("startTime", e.target.value)}
              onBlur={() => touch("start")}
            />
          </div>
          <FieldError id="event-start-error" message={startError} />
        </div>

        <div role="group" aria-labelledby="event-end-label">
          <span className="label" id="event-end-label">
            Koniec <span className="opt">opcjonalnie, tego samego dnia</span>
          </span>
          <div className="grid2">
            <input
              type="time"
              className="input"
              aria-label="Godzina końca"
              value={draft.endTime}
              {...errorProps(!!endError, "event-end-error")}
              onChange={(e) => set("endTime", e.target.value)}
              onBlur={() => touch("end")}
            />
          </div>
          <FieldError id="event-end-error" message={endError} />
        </div>

        <LocationField value={draft.location} onChange={(location) => set("location", location)} />

        <div>
          <label className="label" htmlFor="event-description">
            Opis <span className="opt">opcjonalnie</span>
          </label>
          <textarea
            id="event-description"
            className="input"
            value={draft.description}
            maxLength={DESCRIPTION_MAX}
            placeholder="Co planujecie, co warto zabrać"
            aria-invalid={descriptionError ? true : undefined}
            aria-describedby={descriptionError ? "event-description-counter event-description-error" : "event-description-counter"}
            onChange={(e) => set("description", e.target.value)}
            onBlur={() => touch("description")}
          />
          <p id="event-description-counter" className="hint counter">
            {[...draft.description].length} / {DESCRIPTION_MAX}
          </p>
          <FieldError id="event-description-error" message={descriptionError} />
        </div>

        <div>
          {createError && (
            <p ref={createErrorRef} className="alertbox form-alert" role="alert" tabIndex={-1}>
              {createError}
            </p>
          )}
          <button
            type="submit"
            className="btn"
            aria-disabled={invalid ? true : undefined}
            aria-describedby={invalid ? SUBMIT_HINT_ID : undefined}
          >
            Zapisz wydarzenie
          </button>
          {invalid && (
            <p id={SUBMIT_HINT_ID} className="hint">
              {MESSAGES.submitHint}
            </p>
          )}
        </div>
      </form>
    </main>
  );
}
