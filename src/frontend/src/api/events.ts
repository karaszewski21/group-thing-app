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

export interface EventBannerResponse {
  url: string;
  status: ModerationStatus;
}

export function createEvent(request: CreateEventRequest): Promise<EventResponse> {
  return api.post("/events", request);
}

/** Replaces any banner already stored for the event. */
export function uploadEventBanner(eventId: string, file: File): Promise<EventBannerResponse> {
  const body = new FormData();
  body.append("file", file);
  return api.upload(`/events/${eventId}/banner`, body);
}
