import type { CreateEventRequest } from "../../api/events";
import dayjs from "../../utils/dayjs";

type Dayjs = ReturnType<typeof dayjs>;

/** Same texts as the backend (`app/events/service.py`). */
export const EVENT_MESSAGES = {
  nameBlank: "Podaj nazwę wydarzenia.",
  nameLength: "Nazwa musi mieć od 3 do 120 znaków.",
  startMissing: "Podaj datę i godzinę początku.",
  startPast: "Początek nie może być w przeszłości.",
  startTooFar: "Początek może być najwyżej 2 lata od dziś.",
  endNotAfter: "Koniec musi być później niż początek.",
  descriptionLength: "Opis może mieć najwyżej 2000 znaków.",
  bannerInvalid: "Nieobsługiwany plik — dodaj zdjęcie JPG, PNG lub WebP",
  bannerTooLarge: "Baner jest za duży (maks. 5 MB)",
} as const;

export const EVENT_NAME_MIN = 3;
export const EVENT_NAME_MAX = 120;
export const EVENT_DESCRIPTION_MAX = 2000;
export const BANNER_TYPES = "image/jpeg,image/png,image/webp";
const BANNER_MAX_BYTES = 5 * 1024 * 1024;
const START_MAX_DAYS_AHEAD = 730;

/** Form state: `date` is `YYYY-MM-DD`, times are `HH:mm`; the end always uses the start date. */
export interface EventDraft {
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  description: string;
  locationId: string | null;
}

export const EMPTY_EVENT_DRAFT: EventDraft = {
  name: "",
  date: "",
  startTime: "",
  endTime: "",
  description: "",
  locationId: null,
};

export type EventDraftErrors = Partial<Record<"name" | "start" | "end" | "description", string>>;

/** Length in code points, as the backend's Python `len()` counts. */
export function charCount(value: string): number {
  return [...value].length;
}

function parseLocal(date: string, time: string): Dayjs | null {
  const parsed = dayjs(`${date} ${time.slice(0, 5)}`, "YYYY-MM-DD HH:mm", true);
  return parsed.isValid() ? parsed : null;
}

export function bannerFileError(file: File): string | null {
  if (!BANNER_TYPES.split(",").includes(file.type)) return EVENT_MESSAGES.bannerInvalid;
  if (file.size > BANNER_MAX_BYTES) return EVENT_MESSAGES.bannerTooLarge;
  return null;
}

/** Browser-side mirror of the backend rules for instant feedback; the server
 * stays the authority (it checks against Warsaw time). */
export function validateEventDraft(draft: EventDraft, now: Dayjs): EventDraftErrors {
  const errors: EventDraftErrors = {};

  const name = draft.name.trim();
  if (name === "") errors.name = EVENT_MESSAGES.nameBlank;
  else if (charCount(name) < EVENT_NAME_MIN || charCount(name) > EVENT_NAME_MAX) errors.name = EVENT_MESSAGES.nameLength;

  const start = parseLocal(draft.date, draft.startTime);
  if (!start) {
    errors.start = EVENT_MESSAGES.startMissing;
  } else {
    if (start.isBefore(now.startOf("minute"))) errors.start = EVENT_MESSAGES.startPast;
    else if (start.isAfter(now.add(START_MAX_DAYS_AHEAD, "day"))) errors.start = EVENT_MESSAGES.startTooFar;

    const end = draft.endTime === "" ? null : parseLocal(draft.date, draft.endTime);
    if (end && !end.isAfter(start)) errors.end = EVENT_MESSAGES.endNotAfter;
  }

  if (charCount(draft.description.trim()) > EVENT_DESCRIPTION_MAX) errors.description = EVENT_MESSAGES.descriptionLength;

  return errors;
}

/** Naive `YYYY-MM-DDTHH:mm:00` wall-clock strings; `ends_at` reuses the start date. */
export function toCreateEventRequest(draft: EventDraft): CreateEventRequest {
  const at = (time: string) => `${draft.date}T${time.slice(0, 5)}:00`;
  const description = draft.description.trim();
  return {
    name: draft.name.trim(),
    description: description === "" ? null : description,
    starts_at: at(draft.startTime),
    ends_at: draft.endTime === "" ? null : at(draft.endTime),
    location_id: draft.locationId,
  };
}
