import { describe, expect, it } from "vitest";
import {
  APPEARANCE_LOAD_ERROR,
  resolveAppearanceView,
  type AppearanceView,
} from "../features/editor/appearanceViewState";

interface Owner {
  slug: string;
}

type Input = Parameters<typeof resolveAppearanceView<Owner>>[0];

const OWNER: Owner = { slug: "muzyczne-skrzaty" };
const BASE: Input = { loggedIn: true, loading: false, error: null, owner: null };

describe("resolveAppearanceView", () => {
  it.each<{ name: string; input: Partial<Input>; expected: AppearanceView<Owner> }>([
    { name: "a visitor logs in first", input: { loggedIn: false }, expected: { kind: "login" } },
    {
      name: "a visitor logs in even with stale owner data",
      input: { loggedIn: false, owner: OWNER, loading: true },
      expected: { kind: "login" },
    },
    { name: "own read pending", input: { loading: true }, expected: { kind: "loading" } },
    { name: "own page loaded", input: { owner: OWNER }, expected: { kind: "content", owner: OWNER } },
    {
      name: "a refetch keeps the editor",
      input: { owner: OWNER, loading: true },
      expected: { kind: "content", owner: OWNER },
    },
    {
      name: "a failed refresh keeps the editor",
      input: { owner: OWNER, error: "Błąd serwera" },
      expected: { kind: "content", owner: OWNER },
    },
    {
      name: "failed first read",
      input: { error: "Błąd serwera" },
      expected: { kind: "error", message: APPEARANCE_LOAD_ERROR },
    },
    { name: "someone else's page (or none)", input: {}, expected: { kind: "notFound" } },
  ])("$name", ({ input, expected }) => {
    expect(resolveAppearanceView<Owner>({ ...BASE, ...input })).toEqual(expected);
  });
});
