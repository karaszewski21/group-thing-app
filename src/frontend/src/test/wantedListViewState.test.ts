import { describe, expect, it } from "vitest";
import { resolveWantedListView } from "../features/wanted/wantedListViewState";
import { makeWant } from "./fixtures/wants";

const WANTS = [makeWant(), makeWant({ id: "want-2", status: "EXPIRED", closed_at: "2026-11-12T12:00:00" })];

describe("resolveWantedListView", () => {
  it.each([
    ["first load", { loading: true, error: null, wants: [] }, { kind: "loading" }],
    ["first load failed", { loading: false, error: "boom", wants: [] }, { kind: "error", message: "boom" }],
    ["no wants", { loading: false, error: null, wants: [] }, { kind: "empty" }],
    ["wants", { loading: false, error: null, wants: WANTS }, { kind: "list", wants: WANTS, refreshError: null }],
    [
      "stale list, the refresh failed",
      { loading: false, error: "boom", wants: WANTS },
      { kind: "list", wants: WANTS, refreshError: "boom" },
    ],
  ])("%s", (_label, state, expected) => {
    expect(resolveWantedListView(state)).toEqual(expected);
  });
});
