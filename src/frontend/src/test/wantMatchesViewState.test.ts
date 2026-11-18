import { describe, expect, it } from "vitest";
import { resolveWantMatchesView, type WantMatchesData } from "../features/wanted/wantMatchesViewState";
import { makeWant, makeWantMatch, makeWantSuggestion } from "./fixtures/wants";

const MATCH = makeWantMatch();
const SUGGESTION = makeWantSuggestion();
const ACTIVE = makeWant();
const MATCHING = makeWant({ matching: true });
const EXPIRED = makeWant({ status: "EXPIRED", closed_at: "2026-11-12T10:00:00" });
const FULFILLED = makeWant({ status: "FULFILLED", closed_at: "2026-11-12T10:00:00" });
const WITHDRAWN = makeWant({ status: "WITHDRAWN", closed_at: "2026-11-15T10:00:00" });

function data(overrides: Partial<WantMatchesData>): WantMatchesData {
  return {
    want: null,
    matches: [],
    suggestions: [],
    slow: false,
    loading: false,
    notFound: false,
    error: null,
    ...overrides,
  };
}

describe("resolveWantMatchesView", () => {
  it.each([
    ["first load", data({ loading: true }), { kind: "loading" }],
    ["failed first load", data({ error: "Błąd serwera." }), { kind: "error", message: "Błąd serwera." }],
    ["unknown want", data({ notFound: true }), { kind: "notFound" }],
    [
      "want that vanished after it was shown",
      data({ want: ACTIVE, matches: [MATCH], notFound: true }),
      { kind: "notFound" },
    ],
    ["want withdrawn a moment ago", data({ want: WITHDRAWN, matches: [MATCH] }), { kind: "notFound" }],
    [
      "active want with matches",
      data({ want: ACTIVE, matches: [MATCH] }),
      { kind: "active", want: ACTIVE, matches: [MATCH], suggestions: [] },
    ],
    [
      "active want with matches and suggestions",
      data({ want: ACTIVE, matches: [MATCH], suggestions: [SUGGESTION] }),
      { kind: "active", want: ACTIVE, matches: [MATCH], suggestions: [SUGGESTION] },
    ],
    ["active want without matches", data({ want: ACTIVE }), { kind: "activeEmpty", want: ACTIVE, suggestions: [] }],
    [
      "active want with only suggestions",
      data({ want: ACTIVE, suggestions: [SUGGESTION] }),
      { kind: "activeEmpty", want: ACTIVE, suggestions: [SUGGESTION] },
    ],
    [
      "new want the matcher has not answered yet",
      data({ want: MATCHING }),
      { kind: "matching", want: MATCHING, matches: [], suggestions: [] },
    ],
    [
      "resumed want still matching keeps its stored matches",
      data({ want: MATCHING, matches: [MATCH], suggestions: [SUGGESTION] }),
      { kind: "matching", want: MATCHING, matches: [MATCH], suggestions: [SUGGESTION] },
    ],
    [
      "matching past the polling window",
      data({ want: MATCHING, matches: [MATCH], slow: true }),
      { kind: "matchingSlow", want: MATCHING, matches: [MATCH], suggestions: [] },
    ],
    [
      "stale matching data with a refresh error",
      data({ want: MATCHING, error: "Błąd serwera." }),
      { kind: "matching", want: MATCHING, matches: [], suggestions: [] },
    ],
    [
      "expired want",
      data({ want: EXPIRED, matches: [MATCH], suggestions: [SUGGESTION] }),
      { kind: "expired", want: EXPIRED, matches: [MATCH] },
    ],
    ["expired want without matches", data({ want: EXPIRED }), { kind: "expired", want: EXPIRED, matches: [] }],
    [
      "fulfilled want",
      data({ want: FULFILLED, matches: [MATCH], suggestions: [SUGGESTION] }),
      { kind: "fulfilled", want: FULFILLED, matches: [MATCH] },
    ],
    [
      "closed want that was still matching",
      data({ want: makeWant({ ...EXPIRED, matching: true }), slow: true }),
      { kind: "expired", want: makeWant({ ...EXPIRED, matching: true }), matches: [] },
    ],
    [
      "stale data with a refresh error",
      data({ want: ACTIVE, matches: [MATCH], error: "Błąd serwera." }),
      { kind: "active", want: ACTIVE, matches: [MATCH], suggestions: [] },
    ],
    [
      "stale data while refreshing",
      data({ want: ACTIVE, matches: [MATCH], loading: true }),
      { kind: "active", want: ACTIVE, matches: [MATCH], suggestions: [] },
    ],
  ])("%s", (_name, input, expected) => {
    expect(resolveWantMatchesView(input)).toEqual(expected);
  });
});
