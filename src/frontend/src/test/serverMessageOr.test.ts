import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { ACCESS_DENIED_MESSAGE, serverMessageOr } from "../api/problem";

const FALLBACK = "Nie udało się — spróbuj ponownie";

describe("serverMessageOr", () => {
  it.each<[string, unknown, string]>([
    ["400 domain message", new ApiError(400, "Bad Request", { message: "Rok urodzenia można ustawić tylko dziecku" }), "Rok urodzenia można ustawić tylko dziecku"],
    ["409 domain message", new ApiError(409, "Conflict", { message: "Nie można usunąć jedynego opiekuna rodziny" }), "Nie można usunąć jedynego opiekuna rodziny"],
    ["400 validation envelope", new ApiError(400, "Bad Request", { message: "Validation failed", fieldErrors: { name: "x" } }), FALLBACK],
    ["403 access denied", new ApiError(403, "Forbidden", { message: "Access denied" }), ACCESS_DENIED_MESSAGE],
    ["500 with message envelope", new ApiError(500, "Server Error", { message: "Internal Server Error" }), FALLBACK],
    ["500 without body", new ApiError(500, "Server Error", null), FALLBACK],
    ["network error", new TypeError("Failed to fetch"), FALLBACK],
  ])("%s", (_label, err, expected) => {
    expect(serverMessageOr(err, FALLBACK)).toBe(expected);
  });

  it("serverMessageOr_503WithMessage_returnsServerMessage", () => {
    const err = new ApiError(503, "Service Unavailable", {
      message: "Moderacja jest chwilowo niedostępna — spróbuj za chwilę.",
    });
    expect(serverMessageOr(err, FALLBACK)).toBe("Moderacja jest chwilowo niedostępna — spróbuj za chwilę.");
  });
});
