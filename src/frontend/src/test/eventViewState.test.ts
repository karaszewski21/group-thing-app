import { describe, expect, it } from "vitest";
import type { EventDetailResponse } from "../api/events";
import { resolveEventView, type EventViewState } from "../pages/events/eventViewState";

function event(overrides: Partial<EventDetailResponse> = {}): EventDetailResponse {
  return {
    id: "ev-1",
    name: "Piknik",
    description: null,
    starts_at: "2026-11-02T17:00:00",
    ends_at: null,
    location: null,
    created_at: "",
    updated_at: "",
    author_slug: "zielony-krag",
    banner_url: null,
    attendee_count: 0,
    is_author: false,
    author_display_name: "Fundacja Zielony Krąg",
    organization: null,
    participants: [],
    is_attending: false,
    has_ended: false,
    open_reservations: null,
    ...overrides,
  };
}

const visitorEvent = event();
const endedEvent = event({ has_ended: true });
const authorEvent = event({ is_author: true });
const attendeeEvent = event({ is_attending: true });

type Input = Parameters<typeof resolveEventView>[0];

const BASE: Input = {
  data: null,
  loading: false,
  notFound: false,
  error: null,
  isStale: false,
  isLoggedIn: false,
  guestProfileId: null,
};

describe("resolveEventView", () => {
  it.each<[string, Partial<Input>, EventViewState]>([
    ["loading", { loading: true }, { kind: "loading" }],
    ["a 404 wins, even over stale data", { data: visitorEvent, notFound: true, isStale: true }, { kind: "notFound" }],
    ["a failed first load", { error: "500" }, { kind: "error", message: "500" }],
    ["the author", { data: authorEvent, isLoggedIn: true }, { kind: "author", event: authorEvent }],
    [
      "an attendee",
      { data: attendeeEvent, isLoggedIn: true },
      { kind: "attendee", event: attendeeEvent, ended: false },
    ],
    [
      "an anonymous guest with a valid key",
      { data: visitorEvent, guestProfileId: "prof-9" },
      { kind: "guestAttendee", event: visitorEvent, guestProfileId: "prof-9" },
    ],
    [
      "a logged-in visitor ignores a leftover guest key",
      { data: visitorEvent, isLoggedIn: true, guestProfileId: "prof-9" },
      { kind: "visitor", event: visitorEvent, ended: false, isLoggedIn: true },
    ],
    [
      "an anonymous visitor",
      { data: visitorEvent },
      { kind: "visitor", event: visitorEvent, ended: false, isLoggedIn: false },
    ],
    [
      "a visitor after the event ended",
      { data: endedEvent },
      { kind: "visitor", event: endedEvent, ended: true, isLoggedIn: false },
    ],
    [
      "anonymous data, now logged in (in-page merge/login)",
      { data: visitorEvent, isStale: true, isLoggedIn: true },
      { kind: "refreshing", event: visitorEvent, error: null },
    ],
    [
      "author data, now logged out: no author controls",
      { data: authorEvent, isStale: true },
      { kind: "refreshing", event: authorEvent, error: null },
    ],
    [
      "stale data whose refresh failed",
      { data: visitorEvent, isStale: true, isLoggedIn: true, error: "500" },
      { kind: "refreshing", event: visitorEvent, error: "500" },
    ],
    [
      "a failed refresh of current data keeps the content view",
      { data: attendeeEvent, isLoggedIn: true, error: "500" },
      { kind: "attendee", event: attendeeEvent, ended: false },
    ],
  ])("%s", (_label, overrides, expected) => {
    expect(resolveEventView({ ...BASE, ...overrides })).toEqual(expected);
  });
});
