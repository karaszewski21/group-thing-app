import { focusManager, onlineManager } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as authApi from "../api/auth";
import { ApiError } from "../api/client";
import * as emailApi from "../api/email";
import type { EmailPreferencesResponse } from "../api/email";
import { useOptionalPanelReload } from "../features/panel/appDataStore";
import { useAccountTokenLookup } from "../hooks/useAccountTokenLookup";
import { EMAIL_PREFERENCES_KEY, useEmailPreferences } from "../hooks/useEmailPreferences";
import { useEmailVerificationRequest } from "../hooks/useEmailVerificationRequest";
import { MY_PROFILE_KEY } from "../hooks/useMyProfile";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";

let mockAuth: { token: string | null };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

vi.mock("../api/auth", () => ({
  requestEmailVerification: vi.fn(),
  confirmEmailVerification: vi.fn(),
  lookupAccountToken: vi.fn(),
}));

vi.mock("../api/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/email")>();
  return { ...actual, getEmailPreferences: vi.fn(), updateEmailPreference: vi.fn() };
});

const PREFERENCES: EmailPreferencesResponse = {
  email: "ania@example.pl",
  email_verified: true,
  suppression: null,
  support_address: "pomoc@example.pl",
  notifications_live: true,
  all_enabled: true,
  categories: [
    { category: "RESERVATIONS", enabled: true },
    { category: "WANTS", enabled: true },
  ],
};

function invalidatedPrefixes(spy: { mock: { calls: unknown[][] } }): unknown[] {
  return spy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey[0]);
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth = { token: "jwt" };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useEmailPreferences", () => {
  it("update saves the switch and resolves only after the preferences are invalidated", async () => {
    vi.mocked(emailApi.getEmailPreferences).mockResolvedValue(PREFERENCES);
    vi.mocked(emailApi.updateEmailPreference).mockResolvedValue({ ...PREFERENCES, all_enabled: false });
    const client = createTestQueryClient();
    let releaseInvalidation = () => {};
    const invalidate = vi
      .spyOn(client, "invalidateQueries")
      .mockImplementation(() => new Promise<void>((resolve) => (releaseInvalidation = resolve)));
    const { result } = renderHook(() => useEmailPreferences(), { wrapper: createQueryWrapper(client) });
    await waitFor(() => expect(result.current.data).toEqual(PREFERENCES));

    let settled = false;
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current.update("ALL", false).then(() => (settled = true));
    });
    await waitFor(() => expect(invalidatedPrefixes(invalidate)).toEqual([EMAIL_PREFERENCES_KEY]));
    expect(emailApi.updateEmailPreference).toHaveBeenCalledWith({ category: "ALL", enabled: false });
    expect(settled).toBe(false);

    await act(async () => {
      releaseInvalidation();
      await pending;
    });
    expect(settled).toBe(true);
  });
});

describe("useEmailVerificationRequest", () => {
  it("marks the link as sent, counts the 60 s cooldown down and re-reads profile and preferences", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-27T10:00:00Z"));
    vi.mocked(authApi.requestEmailVerification).mockResolvedValue(undefined);
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useEmailVerificationRequest(), { wrapper: createQueryWrapper(client) });
    expect(result.current.sent).toBe(false);
    expect(result.current.secondsLeft).toBe(0);

    await act(async () => {
      await result.current.request();
    });
    expect(result.current.sent).toBe(true);
    expect(result.current.secondsLeft).toBe(60);
    expect(result.current.error).toBeNull();
    expect(invalidatedPrefixes(invalidate).sort()).toEqual([EMAIL_PREFERENCES_KEY, MY_PROFILE_KEY].sort());

    await act(async () => {
      await result.current.request();
    });
    expect(authApi.requestEmailVerification).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-11-27T10:00:45Z"));
    await waitFor(() => expect(result.current.secondsLeft).toBe(15), { timeout: 2500 });
    vi.setSystemTime(new Date("2026-11-27T10:01:01Z"));
    await waitFor(() => expect(result.current.secondsLeft).toBe(0), { timeout: 2500 });
    expect(result.current.sent).toBe(true);
  });

  it("maps a 503 to the Polish unavailable copy", async () => {
    vi.mocked(authApi.requestEmailVerification).mockRejectedValue(new ApiError(503, "Service Unavailable", "<html>"));
    const { result } = renderHook(() => useEmailVerificationRequest(), { wrapper: createQueryWrapper() });

    await act(async () => {
      await result.current.request();
    });
    expect(result.current.error).toBe("Wysyłka maili jest chwilowo niedostępna. Spróbuj później.");
    expect(result.current.sent).toBe(false);
    expect(result.current.sending).toBe(false);
  });
});

describe("useAccountTokenLookup", () => {
  afterEach(() => {
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
  });

  it("reads the token once: no refetch on focus or reconnect, data kept", async () => {
    vi.mocked(authApi.lookupAccountToken).mockResolvedValueOnce({ email: "ania@example.pl" });
    vi.mocked(authApi.lookupAccountToken).mockRejectedValue(new ApiError(410, "Gone", { message: "Ten link wygasł" }));
    const { result } = renderHook(() => useAccountTokenLookup("tok", "VERIFY_EMAIL"), {
      wrapper: createQueryWrapper(),
    });
    await waitFor(() => expect(result.current.data).toEqual({ email: "ania@example.pl" }));

    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(authApi.lookupAccountToken).toHaveBeenCalledTimes(1);
    expect(authApi.lookupAccountToken).toHaveBeenCalledWith("tok", "VERIFY_EMAIL");
    expect(result.current.data).toEqual({ email: "ania@example.pl" });
    expect(result.current.invalid).toBe(false);
  });

  it("reports 404/410 as invalid without retrying, and other failures as an error", async () => {
    vi.mocked(authApi.lookupAccountToken).mockRejectedValueOnce(new ApiError(404, "Not Found", {}));
    const invalid = renderHook(() => useAccountTokenLookup("bad", "PASSWORD_RESET"), {
      wrapper: createQueryWrapper(),
    });
    await waitFor(() => expect(invalid.result.current.invalid).toBe(true));
    expect(invalid.result.current.error).toBeNull();
    expect(authApi.lookupAccountToken).toHaveBeenCalledTimes(1);

    vi.mocked(authApi.lookupAccountToken).mockRejectedValueOnce(new ApiError(500, "Server Error", {}));
    const failed = renderHook(() => useAccountTokenLookup("tok", "PASSWORD_RESET"), {
      wrapper: createQueryWrapper(),
    });
    await waitFor(() => expect(failed.result.current.error).not.toBeNull());
    expect(failed.result.current.invalid).toBe(false);
  });
});

describe("useOptionalPanelReload", () => {
  it("is a no-op without AppDataProvider", () => {
    const { result } = renderHook(() => useOptionalPanelReload());
    expect(() => result.current()).not.toThrow();
  });
});
