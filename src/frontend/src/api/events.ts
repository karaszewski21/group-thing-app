import { api } from "./client";
import type { OrganizerTheme } from "./groups";
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
}

/** The author comes first, then active attendees in sign-up order. */
export interface EventParticipant {
  party_id: string;
  display_name: string;
  is_author: boolean;
  /** The viewer themself (the "To Ty" pill). */
  is_me: boolean;
  items: EventParticipantItem[];
}

/** The public event page. `attendee_count` excludes the author;
 * `author_display_name` is the author's Organization name, else their
 * profile name; `is_attending` is the viewer's own active sign-up. */
export interface EventDetailResponse extends EventResponse {
  banner_url: string | null;
  attendee_count: number;
  is_author: boolean;
  author_display_name: string;
  organization: EventOrganization | null;
  participants: EventParticipant[];
  is_attending: boolean;
  has_ended: boolean;
}

/** `guest_name` is required for an anonymous caller, ignored otherwise. */
export interface EventAttendanceRequest {
  guest_name: string | null;
}

export interface EventAttendanceResponse {
  id: string;
  event_id: string;
  user_profile_id: string;
  attached_to_account: boolean;
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
export function signUpForEvent(eventId: string, request: EventAttendanceRequest): Promise<EventAttendanceResponse> {
  return api.post(`/events/${eventId}/attendances`, request);
}

/** Idempotent: succeeds even when the caller isn't signed up. */
export function withdrawFromEvent(eventId: string): Promise<void> {
  return api.post(`/events/${eventId}/attendances/withdraw`, undefined);
}

/** localStorage key for an anonymous visitor's guest sign-up, scoped per event. */
export function eventGuestProfileKey(eventId: string): string {
  return `guest_profile_id:event:${eventId}`;
}

/** Replaces any banner already stored for the event. */
export function uploadEventBanner(eventId: string, file: File): Promise<EventBannerResponse> {
  const body = new FormData();
  body.append("file", file);
  return api.upload(`/events/${eventId}/banner`, body);
}
