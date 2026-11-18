import type { WantMatchResponse, WantResponse, WantSuggestionResponse } from "../../api/wants";

/** What `useWantMatches` knows about the want. */
export interface WantMatchesData {
  want: WantResponse | null;
  matches: WantMatchResponse[];
  suggestions: WantSuggestionResponse[];
  /** Still matching after the polling window. */
  slow: boolean;
  loading: boolean;
  notFound: boolean;
  error: string | null;
}

/** The one screen the match page shows:
 * - `loading` / `error`: the first load is pending or failed.
 * - `notFound`: unknown, foreign, withdrawn or removed want, also when it
 *   vanished after it was shown.
 * - `matching` / `matchingSlow`: an active want the matcher has yet to
 *   answer, within or past the polling window, with whatever is already
 *   stored (a resumed want keeps showing its matches).
 * - `active` / `activeEmpty`: an active want with or without matches.
 * - `expired` / `fulfilled`: a closed want with its stored matches.
 * Only active wants carry suggestions. Loaded data wins over a failed or
 * pending refresh. */
export type WantMatchesViewState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "notFound" }
  | { kind: "matching"; want: WantResponse; matches: WantMatchResponse[]; suggestions: WantSuggestionResponse[] }
  | { kind: "matchingSlow"; want: WantResponse; matches: WantMatchResponse[]; suggestions: WantSuggestionResponse[] }
  | { kind: "active"; want: WantResponse; matches: WantMatchResponse[]; suggestions: WantSuggestionResponse[] }
  | { kind: "activeEmpty"; want: WantResponse; suggestions: WantSuggestionResponse[] }
  | { kind: "expired"; want: WantResponse; matches: WantMatchResponse[] }
  | { kind: "fulfilled"; want: WantResponse; matches: WantMatchResponse[] };

/** Every state of an ACTIVE want: the actions (close, extend, withdraw) apply. */
export type ActiveWantView = Extract<
  WantMatchesViewState,
  { kind: "matching" | "matchingSlow" | "active" | "activeEmpty" }
>;
export type MatchingWantView = Extract<WantMatchesViewState, { kind: "matching" | "matchingSlow" }>;
export type ClosedWantView = Extract<WantMatchesViewState, { kind: "expired" | "fulfilled" }>;

export function resolveWantMatchesView({
  want,
  matches,
  suggestions,
  slow,
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
      if (want.matching) return { kind: slow ? "matchingSlow" : "matching", want, matches, suggestions };
      return matches.length > 0
        ? { kind: "active", want, matches, suggestions }
        : { kind: "activeEmpty", want, suggestions };
    case "EXPIRED":
      return { kind: "expired", want, matches };
    case "FULFILLED":
      return { kind: "fulfilled", want, matches };
    case "WITHDRAWN":
      return { kind: "notFound" };
  }
}
