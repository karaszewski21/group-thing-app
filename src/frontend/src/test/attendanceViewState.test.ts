import { describe, expect, it } from "vitest";
import type { GroupResponse, TermAttendanceResponse, TermAttendeeResponse } from "../api/groups";
import type { TermResponse } from "../api/terms";
import {
  resolveAttendanceView,
  type AttendancePageState,
} from "../features/meetings/attendanceViewState";

const TERM: TermResponse = {
  id: "t1",
  group_id: "g1",
  occurs_on: "2026-12-06T10:00:00",
  description: null,
  created_at: "2026-11-01T10:00:00",
  updated_at: "2026-11-01T10:00:00",
  attendee_count: 1,
  child_count: 0,
  price: null,
  payment_url: null,
  payment_method: null,
};

const GROUP: GroupResponse = {
  id: "g1",
  party_id: "gp1",
  name: "Mamy z Mokotowa",
  description: null,
  organizer_slug: "mamy",
  layout_mode: "CIRCLE",
  visibility: "PUBLIC",
  created_at: "2026-11-01T10:00:00",
  updated_at: "2026-11-01T10:00:00",
  default_price: null,
  default_payment_url: null,
  default_payment_method: null,
};

const ATTENDEES: TermAttendeeResponse[] = [
  {
    party_id: "p1",
    display_name: "Anna Kowalska",
    child_count: 0,
    family_id: null,
    family_name: null,
    children: [],
    present: true,
    is_organizer: false,
    payment_status: "UNPAID",
    withdrawn: false,
    counted: true,
  },
];

function attendance(overrides: Partial<TermAttendanceResponse> = {}): TermAttendanceResponse {
  return {
    state: "OPEN",
    attendance_points: 20,
    allowed_levels: [0, 10, 20],
    attendee_count: 1,
    present_count: 1,
    min_present: 3,
    auto_close_on: "2026-12-13T10:00:00",
    closed_at: null,
    rewarded: null,
    ...overrides,
  };
}

const CLOSED = { state: "CLOSED", closed_at: "2026-12-06T15:00:00", auto_close_on: null } as const;

function page(overrides: Partial<AttendancePageState> = {}): AttendancePageState {
  return {
    term: TERM,
    group: GROUP,
    attendees: ATTENDEES,
    attendance: attendance(),
    denied: false,
    notFound: false,
    error: null,
    ...overrides,
  };
}

describe("resolveAttendanceView", () => {
  it.each<[string, AttendancePageState, string]>([
    ["nothing loaded yet", page({ term: null, group: null, attendees: null, attendance: null }), "loading"],
    ["term loaded, attendance still loading", page({ attendance: null }), "loading"],
    ["attendees still loading", page({ attendees: null }), "loading"],
    ["first load failed", page({ attendees: null, error: "boom" }), "error"],
    ["attendance read failed without data", page({ attendance: null, error: "boom" }), "error"],
    ["403 wins over data", page({ denied: true }), "denied"],
    ["404 wins over an error", page({ term: null, notFound: true, error: "boom" }), "notFound"],
    ["before the start", page({ attendance: attendance({ state: "NOT_STARTED" }) }), "notStarted"],
    ["open", page(), "open"],
    ["stale open data with a refresh error stays shown", page({ error: "boom" }), "open"],
    [
      "closed and rewarded",
      page({ attendance: attendance({ ...CLOSED, rewarded: true, present_count: 3 }) }),
      "closedRewarded",
    ],
    [
      "closed below the minimum",
      page({ attendance: attendance({ ...CLOSED, rewarded: false, present_count: 2 }) }),
      "closedBelowMin",
    ],
    [
      "closed at level 0",
      page({ attendance: attendance({ ...CLOSED, attendance_points: 0, rewarded: false, present_count: 5 }) }),
      "closedNoPoints",
    ],
    [
      "stale closed data with a refresh error stays shown",
      page({ attendance: attendance({ ...CLOSED, rewarded: true }), error: "boom" }),
      "closedRewarded",
    ],
  ])("%s", (_label, state, kind) => {
    expect(resolveAttendanceView(state).kind).toBe(kind);
  });

  it("content kinds carry the loaded data and the error carries its message", () => {
    expect(resolveAttendanceView(page())).toEqual({
      kind: "open",
      term: TERM,
      group: GROUP,
      attendees: ATTENDEES,
      attendance: attendance(),
    });
    expect(resolveAttendanceView(page({ attendance: null, error: "boom" }))).toEqual({
      kind: "error",
      message: "boom",
    });
  });
});
