import { describe, expect, it } from "vitest";
import type { PointsConfigValues } from "../api/points";
import {
  configToForm,
  parseConfigForm,
  parseLevel,
  parseRatio,
  priceBoundsExample,
  priceExampleText,
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
  price_min_ratio: 0.5,
  price_max_ratio: 1.5,
  price_cap: 100,
  price_step: 10,
};

function formWith(patch: Partial<PointsConfigForm>): PointsConfigForm {
  return { ...configToForm(DEFAULTS), ...patch };
}

describe("pointsConfigForm", () => {
  it("shows multipliers with a decimal comma and round-trips the defaults", () => {
    const form = configToForm(DEFAULTS);
    expect(form.multiplier_fair).toBe("0,75");
    expect(form.base_small).toBe("20");
    expect(form.price_min_ratio).toBe("0,50");
    expect(form.price_max_ratio).toBe("1,50");
    expect(form.price_cap).toBe("100");
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
    ["min ratio above 1", { price_min_ratio: "1,01" }, "price_min_ratio", "Minimum ceny musi być liczbą od 0,01 do 1,00."],
    ["max ratio below 1", { price_max_ratio: "0,99" }, "price_max_ratio", "Maksimum ceny musi być liczbą od 1,00 do 3,00."],
    ["cap above 1000", { price_cap: "1010" }, "price_cap", "Cena maksymalna musi być liczbą całkowitą ≤ 1000."],
    ["step 0", { price_step: "0" }, "price_step", "Krok ceny musi być liczbą całkowitą ≥ 1."],
    ["cap not a multiple of the step", { price_cap: "95" }, "price_cap", "Cena maksymalna musi być wielokrotnością kroku ceny."],
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
    ["ratio bounds", { price_min_ratio: "1", price_max_ratio: "3,00", price_cap: "95", price_step: "5" }, { price_min_ratio: 1, price_max_ratio: 3, price_cap: 95, price_step: 5 }],
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

  it.each<[string, number, number, number | undefined]>([
    ["0,01", 0.01, 1, 0.01],
    ["1,00", 0.01, 1, 1],
    [" 0.5 ", 0.01, 1, 0.5],
    ["1,01", 0.01, 1, undefined],
    ["0", 0.01, 1, undefined],
    ["3", 1, 3, 3],
    ["3,01", 1, 3, undefined],
    ["1,155", 1, 3, undefined],
    ["1,5x", 1, 3, undefined],
    ["", 1, 3, undefined],
  ])("parses the ratio %j within %d–%d", (raw, min, max, expected) => {
    expect(parseRatio(raw, min, max)).toBe(expected);
  });

  it.each<[string, [number, number, number, number, number], { min: number; max: number }]>([
    ["s=20 at the defaults", [20, 0.5, 1.5, 100, 10], { min: 10, max: 30 }],
    ["s=40 at the defaults", [40, 0.5, 1.5, 100, 10], { min: 20, max: 60 }],
    ["s=80 capped at 100", [80, 0.5, 1.5, 100, 10], { min: 40, max: 100 }],
    ["30 × 1.15 half-up in hundredths, step 1", [30, 0.5, 1.15, 100, 1], { min: 15, max: 35 }],
    ["s=45 × 1.00 half-up to 50", [45, 1, 1, 100, 10], { min: 50, max: 50 }],
    ["min above max takes max", [40, 1, 1, 20, 10], { min: 20, max: 20 }],
  ])("mirrors price_bounds for %s", (_name, [s, minRatio, maxRatio, cap, step], expected) => {
    expect(priceBoundsExample(s, minRatio, maxRatio, cap, step)).toEqual(expected);
  });

  it("writes the live example from the form, or nothing while a price field is invalid", () => {
    expect(priceExampleText(configToForm(DEFAULTS))).toBe(
      "Przykład: sugestia 20 → 10–30 pkt; sugestia 40 → 20–60 pkt; sugestia 60 → 30–90 pkt; nigdy powyżej 100.",
    );
    expect(priceExampleText(formWith({ price_step: "" }))).toBeNull();
    expect(priceExampleText(formWith({ price_cap: "95" }))).toBeNull();
  });
});
