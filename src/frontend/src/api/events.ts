import { api } from "./client";
import type { OrganizerTheme, ReservedByResponse } from "./groups";
import type { ListingMode } from "./itemListingPreferences";
import type { LocationRefResponse } from "./locations";
import type { ModerationStatus } from "./products";

/** `starts_at`/`ends_at` are naive Warsaw wall-clock strings (`YYYY-MM-DDTHH:mm:00`). */
export interface CreateEventRequest {
  name: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  location_id: string | null;
}

export interface EventResponse {
  id: string;
  name: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  location: LocationRefResponse | null;
  created_at: string;
  updated_at: string;
  /** The author's URL prefix, shared with their term pages: `eventPath(author_slug, id)`. */
  author_slug: string;
}

/** The author's own Organization: its name and colors for the page theme. */
export interface EventOrganization extends OrganizerTheme {
  name: string;
}

/** A live, available item the participant shares, ordered by product name. */
export interface EventParticipantItem {
  item_id: string;
  product_name: string;
  mode: ListingMode;
  thumb_url: string | null;
  /** When it was listed: naive UTC ISO, no offset (parse with `dayjs.utc`). */
  added_at: string;
  /** `null` while the item is available. */
  reservation: ReservedByResponse | null;
}

/** The author comes first, then active attendees in sign-up order. */
export interface EventParticipant {
  party_id: string;
  display_name: string;
  is_author: boolean;
  /** The viewer themself (the "To Ty" pill). */
  is_me: boolean;
  /** The 3 newest listed items; `items_total` counts all of them. */
  items: EventParticipantItem[];
  items_total: number;
}

export interface EventOpenReservations {
  total: number;
  swaps: number;
}

/** The public event page. `attendee_count` excludes the author;
 * `author_display_name` is the author's Organization name, else their
 * profile name; `is_attending` is the viewer's own active sign-up;
 * `open_reservations` is set for the author only, else `null`. */
export interface EventDetailResponse extends EventResponse {
  banner_url: string | null;
  attendee_count: number;
  is_author: boolean;
  author_display_name: string;
  organization: EventOrganization | null;
  participants: EventParticipant[];
  is_attending: boolean;
  has_ended: boolean;
  open_reservations: EventOpenReservations | null;
}

export interface EventAttendanceResponse {
  id: string;
  event_id: string;
  user_profile_id: string;
}

export interface EventBannerResponse {
  url: string;
  status: ModerationStatus;
}

export function createEvent(request: CreateEventRequest): Promise<EventResponse> {
  return api.post("/events", request);
}

export function getEvent(eventId: string): Promise<EventDetailResponse> {
  return api.get(`/events/${eventId}`);
}

/** Every field is sent, so the whole event is replaced by the form's values. */
export function updateEvent(eventId: string, request: CreateEventRequest): Promise<EventResponse> {
  return api.patch(`/events/${eventId}`, request);
}

/** Refused (409) once someone has signed up. */
export function deleteEvent(eventId: string): Promise<void> {
  return api.delete(`/events/${eventId}`);
}

/** The caller's own events, earliest start first. */
export function getMyEvents(): Promise<EventResponse[]> {
  return api.get("/events/mine");
}

/** The events the caller actively attends, earliest start first. */
export function getAttendingEvents(): Promise<EventResponse[]> {
  return api.get("/events/attending");
}

/** Idempotent for a logged-in caller; refused (409) for the author or once the event has ended. */
export function signUpForEvent(eventId: string): Promise<EventAttendanceResponse> {
  return api.post(`/events/${eventId}/attendances`, undefined);
}

/** Idempotent: succeeds even when the caller isn't signed up. */
export function withdrawFromEvent(eventId: string): Promise<void> {
  return api.post(`/events/${eventId}/attendances/withdraw`, undefined);
}

/** Replaces any banner already stored for the event. */
export function uploadEventBanner(eventId: string, file: File): Promise<EventBannerResponse> {
  const body = new FormData();
  body.append("file", file);
  return api.upload(`/events/${eventId}/banner`, body);
}
