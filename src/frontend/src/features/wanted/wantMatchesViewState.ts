import type { WantMatchResponse, WantResponse } from "../../api/wants";

/** What `useWantMatches` knows about the want. */
export interface WantMatchesData {
  want: WantResponse | null;
  matches: WantMatchResponse[];
  loading: boolean;
  notFound: boolean;
  error: string | null;
}

/** The one screen the match page shows:
 * - `loading` / `error`: the first load is pending or failed.
 * - `notFound`: unknown, foreign, withdrawn or removed want, also when it
 *   vanished after it was shown.
 * - `active` / `activeEmpty`: an active want with or without matches.
 * - `expired` / `fulfilled`: a closed want with its stored matches.
 * Loaded data wins over a failed or pending refresh. */
export type WantMatchesViewState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "notFound" }
  | { kind: "active"; want: WantResponse; matches: WantMatchResponse[] }
  | { kind: "activeEmpty"; want: WantResponse }
  | { kind: "expired"; want: WantResponse; matches: WantMatchResponse[] }
  | { kind: "fulfilled"; want: WantResponse; matches: WantMatchResponse[] };

export type ActiveWantView = Extract<WantMatchesViewState, { kind: "active" | "activeEmpty" }>;
export type ClosedWantView = Extract<WantMatchesViewState, { kind: "expired" | "fulfilled" }>;

export function resolveWantMatchesView({
  want,
  matches,
  loading,
  notFound,
  error,
}: WantMatchesData): WantMatchesViewState {
  if (notFound) return { kind: "notFound" };
  if (want === null) {
    return loading || error === null ? { kind: "loading" } : { kind: "error", message: error };
  }
  switch (want.status) {
    case "ACTIVE":
      return matches.length > 0 ? { kind: "active", want, matches } : { kind: "activeEmpty", want };
    case "EXPIRED":
      return { kind: "expired", want, matches };
    case "FULFILLED":
      return { kind: "fulfilled", want, matches };
    case "WITHDRAWN":
      return { kind: "notFound" };
  }
}
