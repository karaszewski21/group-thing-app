import { api } from "./client";
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
}

/** The event page: the event plus its banner, sign-up count and whether
 * the caller wrote it (edit/delete controls). */
export interface EventDetailResponse extends EventResponse {
  banner_url: string | null;
  attendee_count: number;
  is_author: boolean;
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

/** Replaces any banner already stored for the event. */
export function uploadEventBanner(eventId: string, file: File): Promise<EventBannerResponse> {
  const body = new FormData();
  body.append("file", file);
  return api.upload(`/events/${eventId}/banner`, body);
}
