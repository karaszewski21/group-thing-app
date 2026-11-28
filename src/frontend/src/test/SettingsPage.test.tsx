import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme/system";
import { ApiError } from "../api/client";
import type { AppSettingsResponse } from "../api/settings";
import * as settingsApi from "../api/settings";
import { SettingsPage } from "../features/admin/SettingsPage";
import { createQueryWrapper } from "./queryClient";
import { renderWithRoute } from "./renderWithRoute";

vi.mock("../api/settings", () => ({
  getAppSettings: vi.fn(),
  updateAppSettings: vi.fn(),
}));

const SETTINGS: AppSettingsResponse = {
  max_featured_items: 3,
  updated_at: "2026-11-27T10:00:00",
};

const LABEL = "Limit wyróżnionych rzeczy";
const SAVE = "Zapisz";

function renderPage() {
  const QueryWrapper = createQueryWrapper();
  return renderWithRoute(<SettingsPage />, {
    url: "/admin/settings",
    wrapper: ({ children }) => (
      <QueryWrapper>
        <ChakraProvider value={system}>{children}</ChakraProvider>
      </QueryWrapper>
    ),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(settingsApi.getAppSettings).mockResolvedValue(SETTINGS);
});

describe("SettingsPage", () => {
  it("loads the settings and shows the limit as a text integer input", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "Ustawienia" })).toBeInTheDocument();
    expect(screen.getByText("Ogólne ustawienia aplikacji")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Wyróżnione rzeczy" })).toBeInTheDocument();
    const input = screen.getByLabelText(LABEL);
    expect(input).toHaveValue("3");
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("pattern", "[0-9]*");
    expect(
      screen.getByText(
        "Ile rzeczy jeden użytkownik może wyróżnić naraz (0–20). 0 = wyróżnianie wyłączone. Po zmniejszeniu limitu istniejące wyróżnienia zostają.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the ≤ 20 alert for 25 and disables save", async () => {
    renderPage();

    const input = await screen.findByLabelText(LABEL);
    fireEvent.change(input, { target: { value: "25" } });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Limit wyróżnionych rzeczy musi być liczbą całkowitą ≤ 20.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", expect.stringContaining(alert.id));
    expect(screen.getByRole("button", { name: SAVE })).toBeDisabled();

    fireEvent.change(input, { target: { value: "0" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: SAVE })).toBeEnabled();
  });

  it.each(["abc", ""])("shows an inline error for %j", async (raw) => {
    renderPage();

    const input = await screen.findByLabelText(LABEL);
    fireEvent.change(input, { target: { value: raw } });

    expect(screen.getByRole("alert")).toHaveTextContent("Limit wyróżnionych rzeczy musi być liczbą całkowitą ≥ 0.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: SAVE })).toBeDisabled();
  });

  it("sends the read updated_at and shows the server's 409 verbatim", async () => {
    const message = "Ustawienia zostały zmienione w międzyczasie. Odśwież stronę.";
    vi.mocked(settingsApi.updateAppSettings).mockRejectedValue(
      new ApiError(409, "Conflict", { status: 409, error: "Conflict", message }),
    );
    renderPage();

    fireEvent.change(await screen.findByLabelText(LABEL), { target: { value: "5" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: SAVE }));
    });

    await waitFor(() =>
      expect(settingsApi.updateAppSettings).toHaveBeenCalledWith({
        max_featured_items: 5,
        updated_at: SETTINGS.updated_at,
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });
});
