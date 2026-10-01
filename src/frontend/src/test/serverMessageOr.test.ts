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
    ["500 without body", new ApiError(500, "Server Error", null), FALLBACK],
    ["network error", new TypeError("Failed to fetch"), FALLBACK],
  ])("%s", (_label, err, expected) => {
    expect(serverMessageOr(err, FALLBACK)).toBe(expected);
  });
});
