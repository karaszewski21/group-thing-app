import dayjs from "./dayjs";
import { pluralPl } from "./plural";

const UNKNOWN_AGE = "wiek nieznany";

function yearsUnit(n: number): string {
  return pluralPl(n, "rok", "lata", "lat");
}

export const MIN_BIRTH_YEAR = 1900;

/** Empty input is valid (the year is optional). */
export function birthYearError(value: string): string | null {
  if (!value.trim()) return null;
  const year = Number(value);
  const currentYear = dayjs().year();
  if (!Number.isInteger(year) || year < MIN_BIRTH_YEAR || year > currentYear) {
    return `Podaj rok urodzenia z zakresu ${MIN_BIRTH_YEAR}–${currentYear}`;
  }
  return null;
}

export function approxAge(birthYear: number): number {
  return dayjs().year() - birthYear;
}

export function formatApproxAge(age: number): string {
  return `ok. ${age} ${yearsUnit(age)}`;
}

/** "5, 8 lat, wiek nieznany": ages ascending, the unit follows the last number. */
export function formatChildAges(birthYears: ReadonlyArray<number | null>): string {
  const ages = birthYears
    .filter((year): year is number => year !== null)
    .map(approxAge)
    .sort((a, b) => a - b);
  const parts: string[] = [];
  if (ages.length > 0) {
    parts.push(`${ages.join(", ")} ${yearsUnit(ages[ages.length - 1])}`);
  }
  if (ages.length < birthYears.length) parts.push(UNKNOWN_AGE);
  return parts.join(", ");
}
