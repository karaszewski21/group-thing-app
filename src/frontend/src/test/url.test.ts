import { describe, expect, it } from "vitest";
import { isSafeReturnPath } from "../utils/url";

describe("isSafeReturnPath", () => {
  it("accepts a same-origin absolute path", () => {
    expect(isSafeReturnPath("/x/grupa/1/term/2")).toBe(true);
    expect(isSafeReturnPath("/kowalscy/grupa/12/term/34")).toBe(true);
  });

  it.each<[string, string | null | undefined]>([
    ["missing (null)", null],
    ["missing (undefined)", undefined],
    ["empty", ""],
    ["protocol-relative", "//evil.com/x"],
    ["absolute URL", "https://evil.com"],
    ["backslash after slash", "/\\evil.com"],
    ["leading backslashes", "\\\\evil"],
    ["relative path", "evil"],
    ["tab-smuggled protocol-relative", "/\t/evil.com"],
    ["newline-smuggled protocol-relative", "/\n/evil.com"],
    ["carriage-return-smuggled protocol-relative", "/\r/evil.com"],
    ["whitespace", "/ /evil.com"],
  ])("rejects %s", (_label, value) => {
    expect(isSafeReturnPath(value)).toBe(false);
  });
});
