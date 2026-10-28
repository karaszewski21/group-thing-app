import { getSDK } from "../../sdk";
import type { PluginSDKType } from "../../sdk";

const sdk = getSDK();

/** Copy table — the backend (`app/events/service.py`) uses the same texts. */
export const MESSAGES = {
  nameBlank: "Podaj nazwę wydarzenia.",
  nameLength: "Nazwa musi mieć od 3 do 120 znaków.",
  startMissing: "Podaj datę i godzinę początku.",
  startPast: "Początek nie może być w przeszłości.",
  startTooFar: "Początek może być najwyżej 2 lata od dziś.",
  endNotAfter: "Koniec musi być później niż początek.",
  descriptionLength: "Opis może mieć najwyżej 2000 znaków.",
  bannerTooLarge: "Baner jest za duży (maks. 5 MB)",
  bannerInvalid: "Nieobsługiwany plik — dodaj zdjęcie JPG, PNG lub WebP",
  bannerHint: "JPG, PNG lub WebP, do 5 MB",
  bannerFailed: "Nie udało się wysłać banera. Wydarzenie jest zapisane bez banera.",
  submitHint: "Uzupełnij nazwę oraz datę i godzinę początku, aby zapisać.",
  createLocation: "Wybrane miejsce jest niedostępne — wybierz inne.",
  session: "Sesja wygasła — zaloguj się ponownie.",
  createGeneric: "Nie udało się zapisać wydarzenia. Spróbuj ponownie.",
  createUnconfirmed: "Nie udało się potwierdzić zapisu — wydarzenie mogło zostać zapisane. Odczekaj chwilę przed ponowną próbą.",
  placeName: "Podaj nazwę miejsca.",
  placeAddress: "Podaj adres miejsca.",
  placeInvalid: "Uzupełnij nazwę i adres miejsca.",
  placeGeneric: "Nie udało się dodać miejsca. Spróbuj ponownie.",
  placesLoad: "Nie udało się wczytać miejsc.",
} as const;

export const NAME_MIN = 3;
export const NAME_MAX = 120;
export const DESCRIPTION_MAX = 2000;
export const PLACE_NAME_MAX = 255;
export const PLACE_ADDRESS_MAX = 500;
export const BANNER_MAX_BYTES = 5 * 1024 * 1024;
export const BANNER_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const START_MAX_DAYS_AHEAD = 730;

export interface LocationResponse {
  id: string;
  name: string;
  formatted_address: string;
}

/** Only the fields the plugin reads; the response carries more. */
export interface EventResponse {
  id: string;
  name: string;
  starts_at: string;
  ends_at: string | null;
  location: LocationResponse | null;
}

export interface EventBannerResponse {
  url: string;
}

/** Form state: `date` is `YYYY-MM-DD`, times are `HH:mm`; the end always uses the start date. */
export interface EventDraft {
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  description: string;
  location: LocationResponse | null;
  banner: File | null;
}

export const EMPTY_DRAFT: EventDraft = {
  name: "",
  date: "",
  startTime: "",
  endTime: "",
  description: "",
  location: null,
  banner: null,
};

export type DraftField = "banner" | "name" | "start" | "end" | "description";
export type DraftErrors = Partial<Record<DraftField, string>>;

export interface PlaceInput {
  name: string;
  address: string;
}
export type PlaceErrors = Partial<Record<keyof PlaceInput, string>>;

export interface CreateEventRequest {
  name: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  location_id: string | null;
}

export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

type HostResponse = Awaited<ReturnType<PluginSDKType["hostApp"]["fetch"]>>;

/** Length in code points, as the backend's Python `len()` counts. */
function charCount(value: string): number {
  return [...value].length;
}

function parseLocal(date: string, time: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})/.exec(time);
  if (!d || !t) return null;
  const parsed = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function truncateToMinute(value: Date): Date {
  const copy = new Date(value);
  copy.setSeconds(0, 0);
  return copy;
}

export function validateBanner(file: Blob): string | undefined {
  if (!(BANNER_MIME_TYPES as readonly string[]).includes(file.type)) return MESSAGES.bannerInvalid;
  if (file.size > BANNER_MAX_BYTES) return MESSAGES.bannerTooLarge;
  return undefined;
}

/** Browser-side mirror of the backend rules; the server stays the authority (it uses Warsaw time). */
export function validateDraft(draft: EventDraft, now: Date): DraftErrors {
  const errors: DraftErrors = {};

  if (draft.banner) {
    const bannerError = validateBanner(draft.banner);
    if (bannerError) errors.banner = bannerError;
  }

  const name = draft.name.trim();
  if (name === "") errors.name = MESSAGES.nameBlank;
  else if (charCount(name) < NAME_MIN || charCount(name) > NAME_MAX) errors.name = MESSAGES.nameLength;

  const start = parseLocal(draft.date, draft.startTime);
  if (!start) {
    errors.start = MESSAGES.startMissing;
  } else {
    const nowMinute = truncateToMinute(now);
    const latest = new Date(now);
    latest.setDate(latest.getDate() + START_MAX_DAYS_AHEAD);
    if (start < nowMinute) errors.start = MESSAGES.startPast;
    else if (start > latest) errors.start = MESSAGES.startTooFar;

    const end = draft.endTime === "" ? null : parseLocal(draft.date, draft.endTime);
    if (end && end <= start) errors.end = MESSAGES.endNotAfter;
  }

  if (charCount(draft.description.trim()) > DESCRIPTION_MAX) errors.description = MESSAGES.descriptionLength;

  return errors;
}

export function validatePlace(place: PlaceInput): PlaceErrors {
  const errors: PlaceErrors = {};
  if (place.name.trim() === "") errors.name = MESSAGES.placeName;
  if (place.address.trim() === "") errors.address = MESSAGES.placeAddress;
  return errors;
}

/** Naive `YYYY-MM-DDTHH:mm:00` wall-clock strings; `ends_at` reuses the start date. */
export function toRequest(draft: EventDraft): CreateEventRequest {
  const at = (time: string) => `${draft.date}T${time.slice(0, 5)}:00`;
  const description = draft.description.trim();
  return {
    name: draft.name.trim(),
    description: description === "" ? null : description,
    starts_at: at(draft.startTime),
    ends_at: draft.endTime === "" ? null : at(draft.endTime),
    location_id: draft.location?.id ?? null,
  };
}

// --- Response parsing (no unchecked casts) ---

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function bodyMessage(res: HostResponse): string | null {
  const parsed = parseBody(res.body);
  return isRecord(parsed) && typeof parsed.message === "string" && parsed.message !== "" ? parsed.message : null;
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function toLocation(value: unknown): LocationResponse | null {
  if (!isRecord(value)) return null;
  const { id, name, formatted_address } = value;
  if (typeof id !== "string" || typeof name !== "string" || typeof formatted_address !== "string") return null;
  return { id, name, formatted_address };
}

function toEvent(value: unknown): EventResponse | null {
  if (!isRecord(value)) return null;
  const { id, name, starts_at, ends_at = null, location = null } = value;
  if (typeof id !== "string" || typeof name !== "string" || typeof starts_at !== "string" || !isStringOrNull(ends_at)) {
    return null;
  }
  return { id, name, starts_at, ends_at, location: toLocation(location) };
}

function toBanner(value: unknown): EventBannerResponse | null {
  if (!isRecord(value) || typeof value.url !== "string") return null;
  return { url: value.url };
}

// --- Error mappers, one per call ---

/** `POST /api/events`: a rejected call (e.g. timeout) has no status, and a 201
 * whose body cannot be parsed was still saved, so in both cases the event may
 * exist — create.unconfirmed warns against a blind retry. */
export function createEventError(res: HostResponse | null): string {
  if (!res) return MESSAGES.createUnconfirmed;
  switch (res.status) {
    case 201:
      return MESSAGES.createUnconfirmed;
    case 400:
    case 409:
    case 503:
      return bodyMessage(res) ?? MESSAGES.createGeneric;
    case 401:
      return MESSAGES.session;
    case 403:
    case 404:
      return MESSAGES.createLocation;
    default:
      return MESSAGES.createGeneric;
  }
}

/** `POST /api/events/{id}/banner`: the extra line under banner.failed, or null for none. */
export function bannerError(res: HostResponse | null): string | null {
  if (!res) return null;
  switch (res.status) {
    case 400:
    case 403:
    case 404:
    case 409:
      return bodyMessage(res);
    case 401:
      return MESSAGES.session;
    default:
      return null;
  }
}

/** `POST /api/locations`. */
export function locationError(res: HostResponse | null): string {
  if (!res) return MESSAGES.placeGeneric;
  switch (res.status) {
    case 400:
      return MESSAGES.placeInvalid;
    case 401:
      return MESSAGES.session;
    default:
      return MESSAGES.placeGeneric;
  }
}

// --- API helpers over the host bridge ---

async function call(run: () => Promise<HostResponse>): Promise<HostResponse | null> {
  try {
    return await run();
  } catch (err) {
    console.error("Host call failed", err);
    return null;
  }
}

function jsonRequest(method: string, payload: unknown) {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}

export async function createEvent(request: CreateEventRequest): Promise<Result<EventResponse>> {
  const res = await call(() => sdk.hostApp.fetch("/api/events", jsonRequest("POST", request)));
  const event = res?.status === 201 ? toEvent(parseBody(res.body)) : null;
  return event ? { ok: true, value: event } : { ok: false, error: createEventError(res) };
}

/** On failure `error` is the optional extra line shown under banner.failed. */
export async function uploadBanner(eventId: string, file: File): Promise<Result<EventBannerResponse, string | null>> {
  const res = await call(() => sdk.hostApp.uploadImage(`/api/events/${encodeURIComponent(eventId)}/banner`, file));
  const banner = res?.status === 200 ? toBanner(parseBody(res.body)) : null;
  return banner ? { ok: true, value: banner } : { ok: false, error: bannerError(res) };
}

export async function listMyLocations(): Promise<Result<LocationResponse[]>> {
  const res = await call(() => sdk.hostApp.fetch("/api/locations/mine"));
  if (res?.status === 401) return { ok: false, error: MESSAGES.session };
  const parsed = res?.status === 200 ? parseBody(res.body) : undefined;
  if (!Array.isArray(parsed)) return { ok: false, error: MESSAGES.placesLoad };
  const places = parsed.map(toLocation).filter((p): p is LocationResponse => p !== null);
  return places.length === parsed.length ? { ok: true, value: places } : { ok: false, error: MESSAGES.placesLoad };
}

export async function createLocation(place: PlaceInput): Promise<Result<LocationResponse>> {
  const payload = { name: place.name.trim(), formatted_address: place.address.trim(), source: "MANUAL" };
  const res = await call(() => sdk.hostApp.fetch("/api/locations", jsonRequest("POST", payload)));
  const created = res && (res.status === 201 || res.status === 200) ? toLocation(parseBody(res.body)) : null;
  return created ? { ok: true, value: created } : { ok: false, error: locationError(res) };
}
