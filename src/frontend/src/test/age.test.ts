import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { approxAge, formatApproxAge, formatChildAges } from "../utils/age";

describe("age helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("approxAge subtracts the birth year from the current year", () => {
    expect(approxAge(2018)).toBe(8);
    expect(approxAge(2026)).toBe(0);
  });

  it.each<[number, string]>([
    [1, "ok. 1 rok"],
    [3, "ok. 3 lata"],
    [8, "ok. 8 lat"],
    [12, "ok. 12 lat"],
    [22, "ok. 22 lata"],
  ])("formatApproxAge(%i) is %s", (age, expected) => {
    expect(formatApproxAge(age)).toBe(expected);
  });

  it("formatChildAges sorts ascending, pluralizes by the last number and puts unknown years last", () => {
    expect(formatChildAges([2018, 2021, null])).toBe("5, 8 lat, wiek nieznany");
    expect(formatChildAges([2023, 2025])).toBe("1, 3 lata");
    expect(formatChildAges([null, 2025])).toBe("1 rok, wiek nieznany");
  });

  it("formatChildAges shows only 'wiek nieznany' when no year is known", () => {
    expect(formatChildAges([null, null])).toBe("wiek nieznany");
  });
});
