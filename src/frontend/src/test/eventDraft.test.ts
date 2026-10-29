import { describe, expect, it } from "vitest";
import {
  EMPTY_EVENT_DRAFT,
  EVENT_MESSAGES,
  toCreateEventRequest,
  validateEventDraft,
  type EventDraft,
  type EventDraftErrors,
} from "../pages/add/eventDraft";
import dayjs from "../utils/dayjs";

const NOW = dayjs("2026-10-29 12:00:30", "YYYY-MM-DD HH:mm:ss");
const VALID: EventDraft = { ...EMPTY_EVENT_DRAFT, name: "Piknik", date: "2026-11-02", startTime: "17:00" };

describe("validateEventDraft", () => {
  it.each<[string, Partial<EventDraft>, EventDraftErrors]>([
    ["a valid draft", {}, {}],
    ["an empty draft", EMPTY_EVENT_DRAFT, { name: EVENT_MESSAGES.nameBlank, start: EVENT_MESSAGES.startMissing }],
    ["a too short name", { name: " ab " }, { name: EVENT_MESSAGES.nameLength }],
    ["a start earlier today", { date: "2026-10-29", startTime: "11:59" }, { start: EVENT_MESSAGES.startPast }],
    ["a start this very minute", { date: "2026-10-29", startTime: "12:00" }, {}],
    ["a start over 2 years ahead", { date: "2028-11-01" }, { start: EVENT_MESSAGES.startTooFar }],
    ["an end not after the start", { endTime: "17:00" }, { end: EVENT_MESSAGES.endNotAfter }],
    ["a too long description", { description: "x".repeat(2001) }, { description: EVENT_MESSAGES.descriptionLength }],
  ])("%s", (_label, overrides, expected) => {
    expect(validateEventDraft({ ...VALID, ...overrides }, NOW)).toEqual(expected);
  });
});

describe("toCreateEventRequest", () => {
  it("sends trimmed text and naive wall-clock times on the start date", () => {
    expect(
      toCreateEventRequest({ ...VALID, name: " Piknik ", endTime: "19:30", description: "  ", locationId: "loc-1" }),
    ).toEqual({
      name: "Piknik",
      description: null,
      starts_at: "2026-11-02T17:00:00",
      ends_at: "2026-11-02T19:30:00",
      location_id: "loc-1",
    });
  });
});
