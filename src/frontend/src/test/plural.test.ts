import { describe, expect, it } from "vitest";
import { pluralPl } from "../utils/plural";

describe("pluralPl", () => {
  it.each<[number, string]>([
    [1, "zapis"],
    [2, "zapisy"],
    [4, "zapisy"],
    [5, "zapisów"],
    [12, "zapisów"],
    [22, "zapisy"],
    [0, "zapisów"],
    [112, "zapisów"],
  ])("picks the right form for %i", (n, expected) => {
    expect(pluralPl(n, "zapis", "zapisy", "zapisów")).toBe(expected);
  });
});
