import { describe, expect, it } from "vitest";
import type { EventDetailResponse } from "../api/events";
import { resolveEventView, type EventViewState } from "../pages/events/eventViewState";

const event: EventDetailResponse = {
  id: "ev-1",
  name: "Piknik",
  description: null,
  starts_at: "2026-11-02T17:00:00",
  ends_at: null,
  location: null,
  created_at: "",
  updated_at: "",
  banner_url: null,
  attendee_count: 0,
  is_author: false,
};

describe("resolveEventView", () => {
  it.each<[string, Parameters<typeof resolveEventView>[0], EventViewState]>([
    ["loading", { data: null, loading: true, notFound: false, error: null }, { kind: "loading" }],
    ["loaded", { data: event, loading: false, notFound: false, error: null }, { kind: "content", event }],
    ["a failed refresh keeps the event", { data: event, loading: false, notFound: false, error: "500" }, { kind: "content", event }],
    ["a failed first load", { data: null, loading: false, notFound: false, error: "500" }, { kind: "error", message: "500" }],
    ["a 404, even with old data", { data: event, loading: false, notFound: true, error: null }, { kind: "notFound" }],
  ])("%s", (_label, state, expected) => {
    expect(resolveEventView(state)).toEqual(expected);
  });
});
