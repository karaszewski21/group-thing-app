import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { chatErrorMessage } from "../api/conversations";

const FALLBACK = "Nie udało się wysłać — spróbuj ponownie";

describe("chatErrorMessage", () => {
  it("accessErrors_mapToPolishChatCopy", () => {
    expect(chatErrorMessage(new ApiError(403, "Forbidden", { message: "Access denied" }), FALLBACK)).toBe(
      "Nie masz dostępu do tego czatu.",
    );
    expect(chatErrorMessage(new ApiError(404, "Not Found", { message: "Not found" }), FALLBACK)).toBe(
      "Nie znaleziono — mogło zostać usunięte.",
    );
  });

  it("polishDomainMessages_passThrough", () => {
    const readOnly = "Czat grupy jest dostępny tylko w grupach prywatnych";
    const tooMany = "Za dużo wiadomości — spróbuj ponownie za chwilę.";
    expect(chatErrorMessage(new ApiError(409, "Conflict", { message: readOnly }), FALLBACK)).toBe(readOnly);
    expect(chatErrorMessage(new ApiError(429, "Too Many Requests", { message: tooMany }), FALLBACK)).toBe(tooMany);
  });

  it("genericEnvelopesAndNetworkErrors_useFallback", () => {
    const validation = new ApiError(400, "Bad Request", {
      message: "Validation failed",
      fieldErrors: { body: "too long" },
    });
    expect(chatErrorMessage(validation, FALLBACK)).toBe(FALLBACK);
    expect(chatErrorMessage(new TypeError("Failed to fetch"), FALLBACK)).toBe(FALLBACK);
  });
});
