import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as authApi from "../api/auth";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { clearSession } from "../auth/session";
import { ResetPasswordPage } from "../features/auth/ResetPasswordPage";
import { replaceDocument } from "../routing/documentNavigation";
import { createQueryWrapper } from "./queryClient";
import { renderWithRoute } from "./renderWithRoute";

/** Matches a paragraph by its whole text, across the bold address inside it. */
function paragraph(text: string) {
  return (_: string, element: Element | null) => element?.tagName === "P" && element.textContent === text;
}

vi.mock("../api/auth", () => ({
  requestPasswordReset: vi.fn(),
  confirmPasswordReset: vi.fn(),
  lookupAccountToken: vi.fn(),
}));

vi.mock("../auth/AuthContext", () => ({ useAuth: vi.fn() }));

vi.mock("../auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/session")>();
  return { ...actual, clearSession: vi.fn() };
});

vi.mock("../routing/documentNavigation", () => ({ replaceDocument: vi.fn() }));

const EMAIL = "ania.kowalska@example.pl";

type AuthValue = ReturnType<typeof useAuth>;

function authValue(token: string | null): AuthValue {
  return {
    token,
    username: null,
    displayName: null,
    permissions: [],
    login: vi.fn(),
    register: vi.fn(),
    loginWithGoogle: vi.fn(),
    logout: vi.fn(),
    expireSession: vi.fn(),
  };
}

function renderPage(url: string) {
  return renderWithRoute(<ResetPasswordPage />, { url, wrapper: createQueryWrapper() });
}

function liveToken(): string {
  const payload = btoa(JSON.stringify({ sub: "u", permissions: [], exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;
}

describe("ResetPasswordPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(useAuth).mockReturnValue(authValue(null));
  });

  it("answers every request with the same neutral sent screen", async () => {
    vi.mocked(authApi.requestPasswordReset).mockResolvedValue(undefined);
    renderPage("/reset-password");

    expect(screen.getByRole("heading", { name: "Nie pamiętasz hasła?" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: ` ${EMAIL} ` } });
    fireEvent.click(screen.getByRole("button", { name: "Wyślij link" }));

    expect(await screen.findByRole("heading", { name: "Sprawdź skrzynkę" })).toBeInTheDocument();
    expect(authApi.requestPasswordReset).toHaveBeenCalledExactlyOnceWith(EMAIL);
    expect(
      screen.getByText(paragraph(`Jeśli konto z adresem ${EMAIL} istnieje, wysłaliśmy na nie link. Jest ważny przez godzinę.`)),
    ).toBeInTheDocument();
    expect(screen.getByText("Nie widzisz maila? Zajrzyj do spamu albo spróbuj ponownie za minutę.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Wróć do logowania" })).toHaveAttribute("href", "/login");
  });

  it("keeps the form with an alert while email is off (503)", async () => {
    vi.mocked(authApi.requestPasswordReset).mockRejectedValue(new ApiError(503, "Service Unavailable", null));
    renderPage("/reset-password");

    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: "Wyślij link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Wysyłka maili jest chwilowo niedostępna. Spróbuj później.");
    expect(screen.getByLabelText("E-mail")).toHaveValue(EMAIL);
    expect(screen.getByRole("button", { name: "Wyślij link" })).toBeInTheDocument();
  });

  it("shows the mismatch inline and blocks saving while the passwords differ", async () => {
    vi.mocked(authApi.lookupAccountToken).mockResolvedValue({ email: EMAIL });
    renderPage("/reset-password?token=tok");

    expect(await screen.findByText(`Dla konta ${EMAIL}`)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Nowe hasło"), { target: { value: "sekret123" } });
    fireEvent.change(screen.getByLabelText("Powtórz hasło"), { target: { value: "sekret12" } });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Hasła nie są takie same.");
    const repeat = screen.getByLabelText("Powtórz hasło");
    expect(repeat).toHaveAttribute("aria-invalid", "true");
    expect(repeat).toHaveAttribute("aria-describedby", alert.id);
    const save = screen.getByRole("button", { name: "Zapisz hasło" });
    expect(save).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(save);
    expect(authApi.confirmPasswordReset).not.toHaveBeenCalled();
  });

  it("serves a logged-in visitor the token form, then clears the session and reloads /login", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(liveToken()));
    vi.mocked(authApi.lookupAccountToken).mockResolvedValue({ email: EMAIL });
    vi.mocked(authApi.confirmPasswordReset).mockResolvedValue(undefined);
    renderPage("/reset-password?token=tok");

    expect(await screen.findByRole("heading", { name: "Ustaw nowe hasło" })).toBeInTheDocument();
    expect(authApi.lookupAccountToken).toHaveBeenCalledWith("tok", "PASSWORD_RESET");
    await screen.findByText(`Dla konta ${EMAIL}`);
    fireEvent.change(screen.getByLabelText("Nowe hasło"), { target: { value: "sekret123" } });
    fireEvent.change(screen.getByLabelText("Powtórz hasło"), { target: { value: "sekret123" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz hasło" }));

    expect(await screen.findByRole("heading", { name: "Hasło zmienione" })).toBeInTheDocument();
    expect(authApi.confirmPasswordReset).toHaveBeenCalledExactlyOnceWith("tok", "sekret123");
    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(replaceDocument).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Przejdź do logowania" }));
    expect(replaceDocument).toHaveBeenCalledExactlyOnceWith("/login");
  });

  it("shows an expired link with a way to ask for a new one", async () => {
    vi.mocked(authApi.lookupAccountToken).mockRejectedValue(new ApiError(410, "Gone", null));
    renderPage("/reset-password?token=tok");

    expect(await screen.findByRole("heading", { name: "Link wygasł" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Wyślij nowy link" })).toHaveAttribute("href", "/reset-password");
    await waitFor(() => expect(authApi.lookupAccountToken).toHaveBeenCalledTimes(1));
  });
});
