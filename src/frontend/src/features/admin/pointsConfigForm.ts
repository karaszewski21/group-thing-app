import type { PointsConfigValues } from "../../api/points";

type IntegerField =
  | "base_small"
  | "base_medium"
  | "base_large"
  | "swap_award"
  | "wants_bonus"
  | "attendance_monthly_cap"
  | "attendance_min_present"
  | "attendance_auto_close_days"
  | "pair_reward_limit"
  | "pair_window_days"
  | "max_points_offers";

type MultiplierField =
  | "multiplier_new"
  | "multiplier_like_new"
  | "multiplier_good"
  | "multiplier_fair"
  | "multiplier_poor";

export type PointsConfigField = IntegerField | MultiplierField | "attendance_levels";

/** The form state: the raw input text of every number, plus the level chips. */
export type PointsConfigForm = Record<IntegerField | MultiplierField, string> & { attendance_levels: number[] };

export type PointsConfigErrors = Partial<Record<PointsConfigField, string>>;

// The labels and ranges mirror `app/points/application/config.py`, so the
// inline message is the one the server would send.
const INTEGER_RULES: Record<IntegerField, { label: string; min: number; max: number }> = {
  base_small: { label: "Baza dla małych rzeczy", min: 1, max: 1000 },
  base_medium: { label: "Baza dla średnich rzeczy", min: 1, max: 1000 },
  base_large: { label: "Baza dla dużych rzeczy", min: 1, max: 1000 },
  swap_award: { label: "Punkty za wymianę", min: 0, max: 1000 },
  wants_bonus: { label: "Premia za rzecz z listy „Szukam”", min: 0, max: 1000 },
  attendance_monthly_cap: { label: "Limit miesięczny", min: 0, max: 10000 },
  attendance_min_present: { label: "Minimalna liczba obecnych", min: 1, max: 1000 },
  attendance_auto_close_days: { label: "Liczba dni do automatycznego zamknięcia", min: 1, max: 90 },
  pair_reward_limit: { label: "Limit nagród dla jednej pary", min: 0, max: 100 },
  pair_window_days: { label: "Okno limitu dla pary (dni)", min: 1, max: 365 },
  max_points_offers: { label: "Limit ofert za punkty", min: 0, max: 100 },
};

/** The condition labels of the multipliers, in the form's order. */
export const MULTIPLIER_LABELS: Record<MultiplierField, string> = {
  multiplier_new: "Nowy",
  multiplier_like_new: "Jak nowy",
  multiplier_good: "Dobry",
  multiplier_fair: "Znośny",
  multiplier_poor: "Słaby",
};

const MAX_LEVELS = 5;
const LEVEL_MAX = 1000;
const LEVELS_MESSAGE = "Poziomy obecności muszą mieć od 1 do 5 różnych wartości od 0 do 1000.";
export const NEW_LEVEL_MESSAGE = "Poziom musi być liczbą całkowitą od 0 do 1000.";

/** A non-negative whole number, or `undefined` for anything else. */
function parseWhole(raw: string): number | undefined {
  const trimmed = raw.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
}

/** A multiplier with a dot or a decimal comma and at most two decimals (NUMERIC(4,2)). */
function parseMultiplier(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!/^\d+([.,]\d{1,2})?$/.test(trimmed)) return undefined;
  const value = Number(trimmed.replace(",", "."));
  return value >= 0.01 && value <= 9.99 ? value : undefined;
}

/** The value of the „+ poziom” input, `undefined` unless a whole number 0–1000. */
export function parseLevel(raw: string): number | undefined {
  const value = parseWhole(raw);
  return value !== undefined && value <= LEVEL_MAX ? value : undefined;
}

export function configToForm(config: PointsConfigValues): PointsConfigForm {
  const form = { attendance_levels: [...config.attendance_levels] } as PointsConfigForm;
  for (const field of Object.keys(INTEGER_RULES) as IntegerField[]) {
    form[field] = String(config[field]);
  }
  for (const field of Object.keys(MULTIPLIER_LABELS) as MultiplierField[]) {
    form[field] = String(config[field]).replace(".", ",");
  }
  return form;
}

/** The parsed config when every field is valid, else `null` and a Polish message per invalid field. */
export function parseConfigForm(form: PointsConfigForm): {
  value: PointsConfigValues | null;
  errors: PointsConfigErrors;
} {
  const errors: PointsConfigErrors = {};
  const value = {} as PointsConfigValues;

  for (const [field, { label, min, max }] of Object.entries(INTEGER_RULES) as [
    IntegerField,
    (typeof INTEGER_RULES)[IntegerField],
  ][]) {
    const parsed = parseWhole(form[field]);
    if (parsed === undefined || parsed < min) errors[field] = `${label} musi być liczbą całkowitą ≥ ${min}.`;
    else if (parsed > max) errors[field] = `${label} musi być liczbą całkowitą ≤ ${max}.`;
    else value[field] = parsed;
  }

  for (const [field, condition] of Object.entries(MULTIPLIER_LABELS) as [MultiplierField, string][]) {
    const parsed = parseMultiplier(form[field]);
    if (parsed === undefined) errors[field] = `Mnożnik dla stanu „${condition}” musi być liczbą od 0,01 do 9,99.`;
    else value[field] = parsed;
  }

  const levels = form.attendance_levels;
  if (
    levels.length < 1 ||
    levels.length > MAX_LEVELS ||
    new Set(levels).size !== levels.length ||
    levels.some((level) => level < 0 || level > LEVEL_MAX)
  ) {
    errors.attendance_levels = LEVELS_MESSAGE;
  } else {
    value.attendance_levels = [...levels].sort((a, b) => a - b);
  }

  return Object.keys(errors).length > 0 ? { value: null, errors } : { value, errors };
}
