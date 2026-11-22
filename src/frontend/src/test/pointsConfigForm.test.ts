import { describe, expect, it } from "vitest";
import type { PointsConfigValues } from "../api/points";
import {
  configToForm,
  parseConfigForm,
  parseLevel,
  type PointsConfigField,
  type PointsConfigForm,
} from "../features/admin/pointsConfigForm";

const DEFAULTS: PointsConfigValues = {
  base_small: 20,
  base_medium: 40,
  base_large: 60,
  multiplier_new: 1.5,
  multiplier_like_new: 1.25,
  multiplier_good: 1,
  multiplier_fair: 0.75,
  multiplier_poor: 0.5,
  swap_award: 10,
  wants_bonus: 10,
  attendance_levels: [0, 10, 20],
  attendance_monthly_cap: 40,
  attendance_min_present: 3,
  attendance_auto_close_days: 7,
  pair_reward_limit: 3,
  pair_window_days: 30,
  max_points_offers: 5,
};

function formWith(patch: Partial<PointsConfigForm>): PointsConfigForm {
  return { ...configToForm(DEFAULTS), ...patch };
}

describe("pointsConfigForm", () => {
  it("shows multipliers with a decimal comma and round-trips the defaults", () => {
    const form = configToForm(DEFAULTS);
    expect(form.multiplier_fair).toBe("0,75");
    expect(form.base_small).toBe("20");
    expect(parseConfigForm(form)).toEqual({ value: DEFAULTS, errors: {} });
  });

  it.each<[string, Partial<PointsConfigForm>, PointsConfigField, string]>([
    ["empty base", { base_small: "" }, "base_small", "Baza dla małych rzeczy musi być liczbą całkowitą ≥ 1."],
    ["base 0", { base_medium: "0" }, "base_medium", "Baza dla średnich rzeczy musi być liczbą całkowitą ≥ 1."],
    ["base above 1000", { base_large: "1001" }, "base_large", "Baza dla dużych rzeczy musi być liczbą całkowitą ≤ 1000."],
    ["non-digit cap", { attendance_monthly_cap: "4a" }, "attendance_monthly_cap", "Limit miesięczny musi być liczbą całkowitą ≥ 0."],
    ["negative swap", { swap_award: "-1" }, "swap_award", "Punkty za wymianę musi być liczbą całkowitą ≥ 0."],
    ["auto-close 91", { attendance_auto_close_days: "91" }, "attendance_auto_close_days", "Liczba dni do automatycznego zamknięcia musi być liczbą całkowitą ≤ 90."],
    ["multiplier 0", { multiplier_good: "0" }, "multiplier_good", "Mnożnik dla stanu „Dobry” musi być liczbą od 0,01 do 9,99."],
    ["multiplier 10", { multiplier_new: "10" }, "multiplier_new", "Mnożnik dla stanu „Nowy” musi być liczbą od 0,01 do 9,99."],
    ["multiplier with 3 decimals", { multiplier_poor: "0,555" }, "multiplier_poor", "Mnożnik dla stanu „Słaby” musi być liczbą od 0,01 do 9,99."],
    ["duplicate levels", { attendance_levels: [0, 10, 10] }, "attendance_levels", "Poziomy obecności muszą mieć od 1 do 5 różnych wartości od 0 do 1000."],
    ["six levels", { attendance_levels: [0, 5, 10, 15, 20, 25] }, "attendance_levels", "Poziomy obecności muszą mieć od 1 do 5 różnych wartości od 0 do 1000."],
    ["no levels", { attendance_levels: [] }, "attendance_levels", "Poziomy obecności muszą mieć od 1 do 5 różnych wartości od 0 do 1000."],
  ])("rejects %s with a Polish message", (_name, patch, field, message) => {
    const { value, errors } = parseConfigForm(formWith(patch));
    expect(value).toBeNull();
    expect(errors).toEqual({ [field]: message });
  });

  it.each<[string, Partial<PointsConfigForm>, Partial<PointsConfigValues>]>([
    ["a comma decimal", { multiplier_fair: "0,75" }, { multiplier_fair: 0.75 }],
    ["a dot decimal with spaces", { multiplier_new: " 1.2 " }, { multiplier_new: 1.2 }],
    ["integer bounds", { swap_award: "0", base_small: "1000", pair_window_days: "365" }, { swap_award: 0, base_small: 1000, pair_window_days: 365 }],
    ["levels sorted ascending", { attendance_levels: [20, 0, 5] }, { attendance_levels: [0, 5, 20] }],
  ])("accepts %s", (_name, patch, expected) => {
    const { value, errors } = parseConfigForm(formWith(patch));
    expect(errors).toEqual({});
    expect(value).toEqual({ ...DEFAULTS, ...expected });
  });

  it.each<[string, number | undefined]>([
    ["15", 15],
    [" 0 ", 0],
    ["1000", 1000],
    ["1001", undefined],
    ["", undefined],
    ["1,5", undefined],
  ])("parses the new level %j", (raw, expected) => {
    expect(parseLevel(raw)).toBe(expected);
  });
});
