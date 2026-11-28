import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as authApi from "../api/auth";
import { ApiError } from "../api/client";
import * as emailApi from "../api/email";
import type { EmailPreferencesResponse } from "../api/email";
import { EmailSettingsView } from "../features/email/EmailSettingsView";
import { createQueryWrapper } from "./queryClient";
import { renderWithRoute } from "./renderWithRoute";

vi.mock("../api/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/email")>()),
  getEmailPreferences: vi.fn(),
  updateEmailPreference: vi.fn(),
  unsubscribe: vi.fn(),
}));
vi.mock("../api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/auth")>()),
  requestEmailVerification: vi.fn(),
}));
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ token: "token-a" }),
}));

function preferences(overrides: Partial<EmailPreferencesResponse> = {}): EmailPreferencesResponse {
  return {
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
    ...overrides,
  };
}

function renderSettings() {
  return renderWithRoute(<EmailSettingsView />, {
    url: "/settings",
    wrapper: createQueryWrapper(),
  });
}

describe("EmailSettingsView", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("shows the page parts in the mockup order with the locked account row", async () => {
    vi.mocked(emailApi.getEmailPreferences).mockResolvedValue(preferences());
    renderSettings();

    expect(await screen.findByText("Potwierdzony")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Powiadomienia e-mail" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "‹ Konto" })).toHaveAttribute("href", "/account");
    expect(screen.getAllByRole("switch").map((s) => s.getAttribute("aria-label"))).toEqual([
      "Wszystkie powiadomienia e-mail",
      "Rezerwacje i wymiany",
      "Szukam",
    ]);
    expect(screen.getByText("Zawsze włączone")).toBeInTheDocument();
    expect(screen.queryByText(/ruszają wkrótce/)).not.toBeInTheDocument();
  });

  it("reverts an optimistic switch and shows the server message when the save fails", async () => {
    vi.mocked(emailApi.getEmailPreferences).mockResolvedValue(preferences());
    let reject: (err: unknown) => void = () => {};
    vi.mocked(emailApi.updateEmailPreference).mockReturnValue(
      new Promise((_resolve, rejectSave) => {
        reject = rejectSave;
      }),
    );
    renderSettings();

    const wants = await screen.findByRole("switch", { name: "Szukam" });
    fireEvent.click(wants);
    expect(wants).toHaveAttribute("aria-checked", "false");
    expect(emailApi.updateEmailPreference).toHaveBeenCalledWith({
      category: "WANTS",
      enabled: false,
    });

    reject(new ApiError(400, "Bad Request", { message: "Nie można teraz zmienić." }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nie można teraz zmienić.");
    expect(wants).toHaveAttribute("aria-checked", "true");
  });

  it("falls back to the generic copy when the save fails without a message", async () => {
    vi.mocked(emailApi.getEmailPreferences).mockResolvedValue(preferences());
    vi.mocked(emailApi.updateEmailPreference).mockRejectedValue(new TypeError("Failed to fetch"));
    renderSettings();

    fireEvent.click(
      await screen.findByRole("switch", {
        name: "Wszystkie powiadomienia e-mail",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się zapisać zmiany. Spróbuj ponownie.");
  });

  it("disables every switch while the address is unverified and offers the link", async () => {
    vi.mocked(emailApi.getEmailPreferences).mockResolvedValue(preferences({ email_verified: false }));
    vi.mocked(authApi.requestEmailVerification).mockResolvedValue(undefined);
    renderSettings();

    expect(await screen.findByText("Niepotwierdzony")).toBeInTheDocument();
    for (const toggle of screen.getAllByRole("switch")) expect(toggle).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Wyślij link weryfikacyjny" }));

    const status = await screen.findByText(/^Wysłaliśmy link na ania@example\.pl\./);
    expect(status.closest("[role=status]")).not.toBeNull();
    const again = screen.getByRole("button", {
      name: /^Wyślij ponownie za \d+ s$/,
    });
    expect(again).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(again);
    expect(authApi.requestEmailVerification).toHaveBeenCalledTimes(1);
  });

  it("shows the „wkrótce” note under the heading while notifications are not live", async () => {
    vi.mocked(emailApi.getEmailPreferences).mockResolvedValue(preferences({ notifications_live: false }));
    renderSettings();

    const note = await screen.findByText("Powiadomienia e-mail ruszają wkrótce. Twoje ustawienia zapiszemy już teraz.");
    expect(note).toHaveAttribute("role", "status");
    for (const toggle of screen.getAllByRole("switch")) expect(toggle).toBeEnabled();
  });

  it("shows categories off and disabled while ALL is off", async () => {
    vi.mocked(emailApi.getEmailPreferences).mockResolvedValue(preferences({ all_enabled: false }));
    renderSettings();

    const all = await screen.findByRole("switch", {
      name: "Wszystkie powiadomienia e-mail",
    });
    expect(all).toHaveAttribute("aria-checked", "false");
    expect(all).toBeEnabled();
    for (const name of ["Rezerwacje i wymiany", "Szukam"]) {
      const toggle = screen.getByRole("switch", { name });
      expect(toggle).toHaveAttribute("aria-checked", "false");
      expect(toggle).toBeDisabled();
    }
  });

  it("shows the complaint text with the support address and the error state with a retry", async () => {
    vi.mocked(emailApi.getEmailPreferences).mockRejectedValueOnce(new ApiError(500, "Server Error", null));
    vi.mocked(emailApi.getEmailPreferences).mockResolvedValueOnce(preferences({ suppression: "COMPLAINT" }));
    renderSettings();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Nie udało się wczytać ustawień powiadomień.");
    fireEvent.click(within(alert).getByRole("button", { name: "Spróbuj ponownie" }));

    expect(await screen.findByText("Wstrzymane")).toBeInTheDocument();
    expect(screen.getByText(/napisz do nas: pomoc@example\.pl\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Wyślij/ })).not.toBeInTheDocument();
  });
});
