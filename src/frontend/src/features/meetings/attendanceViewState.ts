import type { GroupResponse, TermAttendanceResponse, TermAttendeeResponse } from "../../api/groups";
import type { TermResponse } from "../../api/terms";

/** Everything the organizer attendees page reads; `null` until loaded. */
export interface AttendancePageState {
  term: TermResponse | null;
  group: GroupResponse | null;
  attendees: TermAttendeeResponse[] | null;
  attendance: TermAttendanceResponse | null;
  denied: boolean;
  notFound: boolean;
  error: string | null;
}

interface AttendanceContent {
  term: TermResponse;
  group: GroupResponse;
  attendees: TermAttendeeResponse[];
  attendance: TermAttendanceResponse;
}

export type AttendanceContentKind =
  | "notStarted"
  | "open"
  | "closedRewarded"
  | "closedBelowMin"
  | "closedNoPoints";

/** The one screen `/terms/:termId/attendees` shows. `loading` keeps the term
 * and group for the head card while the rest loads. */
export type AttendanceView =
  | { kind: "loading"; term: TermResponse | null; group: GroupResponse | null }
  | { kind: "error"; message: string }
  | { kind: "denied" }
  | { kind: "notFound" }
  | ({ kind: AttendanceContentKind } & AttendanceContent);

function contentKind(attendance: TermAttendanceResponse): AttendanceContentKind {
  if (attendance.state === "NOT_STARTED") return "notStarted";
  if (attendance.state === "OPEN") return "open";
  if (attendance.attendance_points === 0) return "closedNoPoints";
  return attendance.rewarded ? "closedRewarded" : "closedBelowMin";
}

/** First match wins: 403, 404, then loaded data (a failed background refresh
 * keeps the stale data shown), then the error, else loading. */
export function resolveAttendanceView(state: AttendancePageState): AttendanceView {
  const { term, group, attendees, attendance } = state;
  if (state.denied) return { kind: "denied" };
  if (state.notFound) return { kind: "notFound" };
  if (term && group && attendees && attendance) {
    return { kind: contentKind(attendance), term, group, attendees, attendance };
  }
  if (state.error) return { kind: "error", message: state.error };
  return { kind: "loading", term, group };
}
