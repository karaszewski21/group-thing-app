import { describe, expect, it } from "vitest";
import {
  initialFromPrefill,
  resolveWantFormView,
  searchBackPath,
  type WantFormViewState,
} from "../features/wanted/wantFormViewState";
import { makeWant } from "./fixtures/wants";

const WANT = makeWant({ id: "want-1" });
const OTHER = makeWant({ id: "want-2", name: "Hulajnoga" });
const EXPIRED = makeWant({ id: "want-1", status: "EXPIRED" });
const FULFILLED = makeWant({ id: "want-1", status: "FULFILLED" });

interface Row {
  title: string;
  input: Parameters<typeof resolveWantFormView>[0];
  expected: WantFormViewState;
}

const ROWS: Row[] = [
  {
    title: "create is ready at once, even while the list loads",
    input: { wantId: null, wants: [], loading: true, error: null },
    expected: { kind: "ready", want: null },
  },
  {
    title: "create stays ready when the list failed",
    input: { wantId: null, wants: [], loading: false, error: "Błąd" },
    expected: { kind: "ready", want: null },
  },
  {
    title: "edit waits for the list",
    input: { wantId: "want-1", wants: [], loading: true, error: null },
    expected: { kind: "loading" },
  },
  {
    title: "edit shows the load error",
    input: { wantId: "want-1", wants: [], loading: false, error: "Błąd sieci" },
    expected: { kind: "error", message: "Błąd sieci" },
  },
  {
    title: "edit of a want that is not on the list is not found",
    input: { wantId: "want-1", wants: [OTHER], loading: false, error: null },
    expected: { kind: "notFound" },
  },
  {
    title: "edit of an active want is ready",
    input: { wantId: "want-1", wants: [OTHER, WANT], loading: false, error: null },
    expected: { kind: "ready", want: WANT },
  },
  {
    title: "a loaded want stays ready through a failed refresh (stale data)",
    input: { wantId: "want-1", wants: [WANT], loading: false, error: "Błąd sieci" },
    expected: { kind: "ready", want: WANT },
  },
  {
    title: "edit of an expired want goes to its match list",
    input: { wantId: "want-1", wants: [EXPIRED], loading: false, error: null },
    expected: { kind: "redirect", to: "/wanted/want-1" },
  },
  {
    title: "edit of a fulfilled want goes to its match list",
    input: { wantId: "want-1", wants: [FULFILLED], loading: false, error: null },
    expected: { kind: "redirect", to: "/wanted/want-1" },
  },
];

describe("resolveWantFormView", () => {
  it.each(ROWS)("$title", ({ input, expected }) => {
    expect(resolveWantFormView(input)).toEqual(expected);
  });
});

const CATEGORY_ID = "5f2b8c1e-3a4d-4e6f-9a7b-1c2d3e4f5a6b";

describe("initialFromPrefill", () => {
  it("reads name, category, offer_type, locality and radius, and opens the disclosure", () => {
    const initial = initialFromPrefill(
      new URLSearchParams(`name=rowerek biegowy&category=${CATEGORY_ID}&offer_type=SWAP&locality=0937730&radius=25`),
    );

    expect(initial).toEqual({
      name: "rowerek biegowy",
      note: "",
      categoryId: CATEGORY_ID,
      offerMode: "SWAP",
      localityId: "0937730",
      radius: 25,
      refined: true,
      fromSearch: true,
    });
    expect(searchBackPath(initial)).toBe(
      `/search?q=rowerek+biegowy&category=${CATEGORY_ID}&offer_type=SWAP&locality=0937730&radius=25`,
    );
  });

  it.each(["cat-1", "1234", `${CATEGORY_ID}x`, " "])("drops a category %j that is not a UUID", (category) => {
    expect(initialFromPrefill(new URLSearchParams({ category }))).toMatchObject({
      categoryId: null,
      refined: false,
      fromSearch: false,
    });
  });

  it("drops a malformed offer type and locality, and a radius without a locality or outside the offered ones", () => {
    expect(initialFromPrefill(new URLSearchParams("offer_type=LEND&locality=abc&radius=10"))).toMatchObject({
      offerMode: null,
      localityId: null,
      radius: null,
      refined: false,
      fromSearch: false,
    });
    expect(initialFromPrefill(new URLSearchParams("locality=0937730&radius=7")).radius).toBeNull();
  });

  it("accepts the POINTS offer type", () => {
    expect(initialFromPrefill(new URLSearchParams("offer_type=POINTS"))).toMatchObject({
      offerMode: "POINTS",
      refined: true,
    });
  });

  it("a name alone keeps the disclosure collapsed but leads back to the search", () => {
    const initial = initialFromPrefill(new URLSearchParams("name=tv"));

    expect(initial).toMatchObject({ name: "tv", refined: false, fromSearch: true });
    expect(searchBackPath(initial)).toBe("/search?q=tv");
  });
});
