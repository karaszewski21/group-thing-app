import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as authApi from "../api/auth";
import { ApiError } from "../api/client";
import { authPath } from "../auth/authPaths";
import { VerifyEmailPage } from "../features/email/VerifyEmailPage";
import { withQueryClient } from "./queryClient";
import { renderWithRoute } from "./renderWithRoute";

/** Matches a paragraph by its whole text, across the bold address inside it. */
function paragraph(text: string) {
  return (_: string, element: Element | null) => element?.tagName === "P" && element.textContent === text;
}

let mockToken: string | null = null;
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: mockToken, username: null, permissions: [] }) }));
vi.mock("../api/auth", () => ({
  lookupAccountToken: vi.fn(),
  confirmEmailVerification: vi.fn(),
  requestEmailVerification: vi.fn(),
}));

const TOKEN = "verify-token";

beforeEach(() => {
  vi.resetAllMocks();
  mockToken = null;
});

/** No `AppDataProvider` around the page: it must work outside the panel (M-5). */
function renderPage(url = `/verify-email?token=${TOKEN}`) {
  renderWithRoute(withQueryClient(<VerifyEmailPage />), { url, pattern: "/verify-email" });
}

describe("VerifyEmailPage", () => {
  it("confirms only on click, then shows the neutral success copy", async () => {
    vi.mocked(authApi.lookupAccountToken).mockResolvedValue({ email: "ania@example.pl" });
    vi.mocked(authApi.confirmEmailVerification).mockResolvedValue(undefined);
    renderPage();

    expect(await screen.findByText(paragraph("Kliknij, żeby potwierdzić ania@example.pl."))).toBeInTheDocument();
    expect(authApi.lookupAccountToken).toHaveBeenCalledWith(TOKEN, "VERIFY_EMAIL");
    expect(authApi.confirmEmailVerification).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Potwierdź adres" }));

    expect(await screen.findByRole("heading", { name: "Adres potwierdzony" })).toBeInTheDocument();
    expect(authApi.confirmEmailVerification).toHaveBeenCalledWith(TOKEN);
    expect(
      screen.getByText(
        "Dziękujemy, Twój adres jest potwierdzony. Możemy wysyłać Ci ważne wiadomości. Ustawienia maili zmienisz w ustawieniach.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ustawienia powiadomień" })).toHaveAttribute("href", "/settings");
  });

  it("guest with an expired link is sent to log in before resending", async () => {
    vi.mocked(authApi.lookupAccountToken).mockRejectedValue(new ApiError(410, "Gone", null));
    renderPage();

    expect(await screen.findByRole("heading", { name: "Link nieważny" })).toBeInTheDocument();
    expect(screen.getByText("Ten link wygasł (48 h) albo został już użyty.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zaloguj się" })).toHaveAttribute("href", authPath("login", "/settings"));
    expect(screen.queryByRole("button", { name: "Wyślij nowy link" })).not.toBeInTheDocument();
  });

  it("logged-in visitor with a used link can resend; a missing token needs no lookup", async () => {
    mockToken = "jwt";
    vi.mocked(authApi.requestEmailVerification).mockResolvedValue(undefined);
    renderPage("/verify-email");

    expect(await screen.findByRole("heading", { name: "Link nieważny" })).toBeInTheDocument();
    expect(authApi.lookupAccountToken).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Zaloguj się" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Wyślij nowy link" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Wysłaliśmy nowy link.");
    expect(authApi.requestEmailVerification).toHaveBeenCalledTimes(1);
  });

  it("a confirm 404 shows the invalid state", async () => {
    vi.mocked(authApi.lookupAccountToken).mockResolvedValue({ email: "ania@example.pl" });
    vi.mocked(authApi.confirmEmailVerification).mockRejectedValue(new ApiError(404, "Not Found", null));
    renderPage();

    await screen.findByText(paragraph("Kliknij, żeby potwierdzić ania@example.pl."));
    fireEvent.click(screen.getByRole("button", { name: "Potwierdź adres" }));

    expect(await screen.findByRole("heading", { name: "Link nieważny" })).toBeInTheDocument();
  });
});
