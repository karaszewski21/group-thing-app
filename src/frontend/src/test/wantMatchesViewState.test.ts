import { describe, expect, it } from "vitest";
import { resolveWantMatchesView, type WantMatchesData } from "../features/wanted/wantMatchesViewState";
import { makeWant, makeWantMatch } from "./fixtures/wants";

const MATCH = makeWantMatch();
const ACTIVE = makeWant();
const EXPIRED = makeWant({ status: "EXPIRED", closed_at: "2026-11-12T10:00:00" });
const FULFILLED = makeWant({ status: "FULFILLED", closed_at: "2026-11-12T10:00:00" });
const WITHDRAWN = makeWant({ status: "WITHDRAWN", closed_at: "2026-11-15T10:00:00" });

function data(overrides: Partial<WantMatchesData>): WantMatchesData {
  return { want: null, matches: [], loading: false, notFound: false, error: null, ...overrides };
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
      { kind: "active", want: ACTIVE, matches: [MATCH] },
    ],
    ["active want without matches", data({ want: ACTIVE }), { kind: "activeEmpty", want: ACTIVE }],
    [
      "expired want",
      data({ want: EXPIRED, matches: [MATCH] }),
      { kind: "expired", want: EXPIRED, matches: [MATCH] },
    ],
    ["expired want without matches", data({ want: EXPIRED }), { kind: "expired", want: EXPIRED, matches: [] }],
    [
      "fulfilled want",
      data({ want: FULFILLED, matches: [MATCH] }),
      { kind: "fulfilled", want: FULFILLED, matches: [MATCH] },
    ],
    [
      "stale data with a refresh error",
      data({ want: ACTIVE, matches: [MATCH], error: "Błąd serwera." }),
      { kind: "active", want: ACTIVE, matches: [MATCH] },
    ],
    [
      "stale data while refreshing",
      data({ want: ACTIVE, matches: [MATCH], loading: true }),
      { kind: "active", want: ACTIVE, matches: [MATCH] },
    ],
  ])("%s", (_name, input, expected) => {
    expect(resolveWantMatchesView(input)).toEqual(expected);
  });
});
