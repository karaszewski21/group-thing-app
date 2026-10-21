import { describe, expect, it } from "vitest";
import { formatJoinCode, parseJoinCode } from "../utils/joinCode";

describe("joinCode", () => {
  it.each<[string, string | null | undefined]>([
    ["", null],
    ["  ", null],
    ["482913", "482913"],
    ["482 913", "482913"],
    ["482-913", "482913"],
    [" 012345 ", "012345"],
    ["48291", undefined],
    ["4829134", undefined],
    ["48a913", undefined],
  ])("parseJoinCode(%j)", (raw, expected) => {
    expect(parseJoinCode(raw)).toBe(expected);
  });

  it("formatJoinCode_sixDigits_splitsIntoTwoTriples", () => {
    expect(formatJoinCode("482913")).toBe("482 913");
  });
});
