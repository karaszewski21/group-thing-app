import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WantResponse } from "../api/wants";
import {
  agoLabel,
  daysLabel,
  daysSince,
  daysUntil,
  daysUntilRemoval,
  matchCountLabel,
  newCountLabel,
  wantSummary,
} from "../features/wanted/wantText";
import { makeWant } from "./fixtures/wants";

const TOYS: Partial<WantResponse> = {
  category_id: "cat-1",
  category_name: "Pojazdy dla dzieci",
  category_path: "Zabawki › Pojazdy dla dzieci",
};
const KETY: Partial<WantResponse> = { locality_id: "0937730", locality_name: "Kęty" };

describe("wantSummary", () => {
  it.each<[string, Partial<WantResponse>, "name" | "path", string]>([
    ["no filters", {}, "name", "Bez doprecyzowania"],
    ["no filters, muted", { notifications_enabled: false }, "name", "Bez doprecyzowania · powiadomienia wyłączone"],
    ["category node name", TOYS, "name", "Pojazdy dla dzieci · cała Polska"],
    ["full category path", TOYS, "path", "Zabawki › Pojazdy dla dzieci · cała Polska"],
    ["gift only", { offer_mode: "GIFT" }, "name", "Oddam · cała Polska"],
    ["swap only", { offer_mode: "SWAP" }, "name", "Zamiana · cała Polska"],
    ["locality alone", KETY, "name", "Kęty"],
    ["locality with a radius", { ...KETY, radius_km: 10 }, "name", "Kęty +10 km"],
    [
      "everything, muted",
      { ...TOYS, ...KETY, offer_mode: "GIFT", radius_km: 25, notifications_enabled: false },
      "name",
      "Pojazdy dla dzieci · Oddam · Kęty +25 km · powiadomienia wyłączone",
    ],
  ])("%s", (_case, overrides, category, expected) => {
    expect(wantSummary(makeWant(overrides), category)).toBe(expected);
  });
});

describe("want count labels", () => {
  it.each([
    [1, "1 pasująca rzecz"],
    [3, "3 pasujące rzeczy"],
    [5, "5 pasujących rzeczy"],
    [12, "12 pasujących rzeczy"],
    [22, "22 pasujące rzeczy"],
  ])("matchCountLabel(%i) is %s", (count, expected) => {
    expect(matchCountLabel(count)).toBe(expected);
  });

  it.each([
    [1, "1 nowa"],
    [2, "2 nowe"],
    [5, "5 nowych"],
  ])("newCountLabel(%i) is %s", (count, expected) => {
    expect(newCountLabel(count)).toBe(expected);
  });

  it.each([
    [1, "1 dzień"],
    [2, "2 dni"],
    [7, "7 dni"],
  ])("daysLabel(%i) is %s", (count, expected) => {
    expect(daysLabel(count)).toBe(expected);
  });
});

describe("want day counts", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads naive timestamps as UTC, whatever the browser's zone", () => {
    expect(daysUntil("2026-11-22T12:00:00")).toBe(7);
    expect(daysSince("2026-11-12T12:00:00")).toBe(3);
  });

  it("daysUntil counts a started day as a whole one and never goes below zero", () => {
    expect(daysUntil("2027-02-13T11:59:00")).toBe(90);
    expect(daysUntil("2026-11-22T12:00:01")).toBe(8);
    expect(daysUntil("2026-11-15T13:00:00")).toBe(1);
    expect(daysUntil("2026-11-14T12:00:00")).toBe(0);
  });

  it("daysSince counts only full days", () => {
    expect(daysSince("2026-11-15T09:00:00")).toBe(0);
    expect(daysSince("2026-11-14T13:00:00")).toBe(0);
    expect(daysSince("2026-11-13T11:00:00")).toBe(2);
  });

  it("agoLabel says „dzisiaj” within the first day, then counts days", () => {
    expect(agoLabel("2026-11-15T09:00:00")).toBe("dzisiaj");
    expect(agoLabel("2026-11-14T13:00:00")).toBe("dzisiaj");
    expect(agoLabel("2026-11-14T12:00:00")).toBe("1 dzień temu");
    expect(agoLabel("2026-11-12T12:00:00")).toBe("3 dni temu");
  });

  it("daysUntilRemoval counts down the 30 days a closed want stays on the list", () => {
    expect(daysUntilRemoval("2026-11-12T12:00:00")).toBe(27);
    expect(daysUntilRemoval("2026-10-01T12:00:00")).toBe(0);
  });
});
