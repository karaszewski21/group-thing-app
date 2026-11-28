import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as emailApi from "../api/email";
import { UnsubscribePage } from "../features/email/UnsubscribePage";
import { withQueryClient } from "./queryClient";
import { renderWithRoute } from "./renderWithRoute";

/** Matches a paragraph by its whole text, across the bold address inside it. */
function paragraph(text: string) {
  return (_: string, element: Element | null) => element?.tagName === "P" && element.textContent === text;
}

vi.mock("../api/email", () => ({ unsubscribe: vi.fn() }));

const TOKEN = "1.RESERVATIONS.0b6f3c2e-8a51-4d1e-9a43-6b3f0f1c2d4e.c2lnbmF0dXJl";

beforeEach(() => {
  vi.resetAllMocks();
});

function renderPage(token = TOKEN) {
  renderWithRoute(withQueryClient(<UnsubscribePage />), {
    url: `/unsubscribe?token=${encodeURIComponent(token)}`,
    pattern: "/unsubscribe",
  });
}

describe("UnsubscribePage", () => {
  it("names the category and turns it off", async () => {
    vi.mocked(emailApi.unsubscribe).mockResolvedValue({ category: "RESERVATIONS", scope: "category" });
    renderPage();

    expect(screen.getByRole("heading", { name: "Wypisz się z maili" })).toBeInTheDocument();
    expect(screen.getByText(paragraph("Ten link dotyczy kategorii Rezerwacje i wymiany."))).toBeInTheDocument();
    expect(screen.getByText("Maile o koncie (reset hasła) zawsze dochodzą.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Wyłącz tę kategorię" }));

    expect(await screen.findByRole("heading", { name: "Gotowe" })).toBeInTheDocument();
    expect(emailApi.unsubscribe).toHaveBeenCalledWith(TOKEN, "category");
    expect(
      screen.getByText(paragraph("Nie wyślemy już maili z kategorii Rezerwacje i wymiany. Powiadomienia w aplikacji działają bez zmian.")),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zmień ustawienia powiadomień" })).toHaveAttribute("href", "/settings");
  });

  it("turns every notification mail off with scope all, after a failed first try", async () => {
    vi.mocked(emailApi.unsubscribe)
      .mockRejectedValueOnce(new ApiError(503, "Service Unavailable", null))
      .mockResolvedValueOnce({ category: "RESERVATIONS", scope: "all" });
    renderPage();

    const all = screen.getByRole("button", { name: "Wyłącz wszystkie powiadomienia e-mail" });
    fireEvent.click(all);
    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się zapisać. Spróbuj ponownie.");
    expect(screen.getByRole("button", { name: "Wyłącz tę kategorię" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Wyłącz wszystkie powiadomienia e-mail" }));

    expect(await screen.findByRole("heading", { name: "Gotowe" })).toBeInTheDocument();
    expect(emailApi.unsubscribe).toHaveBeenLastCalledWith(TOKEN, "all");
    expect(
      screen.getByText("Nie wyślemy już żadnych powiadomień e-mail. Powiadomienia w aplikacji działają bez zmian."),
    ).toBeInTheDocument();
  });

  it("a 404 from the server shows the invalid link state", async () => {
    vi.mocked(emailApi.unsubscribe).mockRejectedValue(new ApiError(404, "Not Found", null));
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Wyłącz tę kategorię" }));

    expect(await screen.findByRole("heading", { name: "Nieprawidłowy link" })).toBeInTheDocument();
    expect(screen.getByText("Nie rozpoznajemy tego linku. Ustawienia maili zmienisz po zalogowaniu.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Przejdź do ustawień" })).toHaveAttribute("href", "/settings");
  });

  it("an unparseable token is invalid without a request", () => {
    renderPage("1.ALL.x.y");

    expect(screen.getByRole("heading", { name: "Nieprawidłowy link" })).toBeInTheDocument();
    expect(emailApi.unsubscribe).not.toHaveBeenCalled();
  });
});
