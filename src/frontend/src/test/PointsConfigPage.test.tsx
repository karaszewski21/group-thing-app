import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme/system";
import { ApiError } from "../api/client";
import type { PointsConfig } from "../api/points";
import * as pointsApi from "../api/points";
import { PointsConfigPage } from "../features/admin/PointsConfigPage";
import { createQueryWrapper } from "./queryClient";
import { renderWithRoute } from "./renderWithRoute";

vi.mock("../api/points", () => ({
  getPointsConfig: vi.fn(),
  updatePointsConfig: vi.fn(),
}));

const CONFIG: PointsConfig = {
  base_small: 20,
  base_medium: 40,
  base_large: 60,
  multiplier_new: 1.5,
  multiplier_like_new: 1.25,
  multiplier_good: 1,
  multiplier_fair: 0.75,
  multiplier_poor: 0.5,
  swap_award: 10,
  wants_bonus: 10,
  attendance_levels: [0, 10, 20],
  attendance_monthly_cap: 40,
  attendance_min_present: 3,
  attendance_auto_close_days: 7,
  pair_reward_limit: 3,
  pair_window_days: 30,
  max_points_offers: 5,
  updated_at: "2026-11-19T10:00:00",
};

function renderPage() {
  const QueryWrapper = createQueryWrapper();
  return renderWithRoute(<PointsConfigPage />, {
    url: "/admin/points",
    wrapper: ({ children }) => (
      <QueryWrapper>
        <ChakraProvider value={system}>{children}</ChakraProvider>
      </QueryWrapper>
    ),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(pointsApi.getPointsConfig).mockResolvedValue(CONFIG);
});

describe("PointsConfigPage", () => {
  it("renders the sections in order with text integer inputs", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "Konfiguracja punktów" })).toBeInTheDocument();
    expect(screen.getByText(/^Zmiany dotyczą tylko przyszłych zdarzeń/)).toBeInTheDocument();
    const legends = screen.getAllByRole("group").map((group) => group.querySelector("legend")?.textContent);
    expect(legends).toEqual([
      "Wycena przedmiotu – baza wg klasy wielkości",
      "Mnożniki stanu",
      "Nagrody",
      "Obecność na terminach",
      "Ochrona przed nabijaniem",
      "Oferty „za punkty” (etap 2)",
    ]);
    const small = screen.getByLabelText("Mała");
    expect(small).toHaveValue("20");
    expect(small).toHaveAttribute("type", "text");
    expect(small).toHaveAttribute("inputmode", "numeric");
    expect(small).toHaveAttribute("pattern", "[0-9]*");
    expect(screen.getByLabelText("Znośny")).toHaveValue("0,75");
    expect(screen.getByLabelText("Znośny")).toHaveAttribute("inputmode", "decimal");
    expect(screen.getByRole("button", { name: "Usuń poziom 10" })).toBeInTheDocument();
  });

  it("shows an inline alert on an invalid input and disables save", async () => {
    renderPage();

    const cap = await screen.findByLabelText("Limit miesięczny na osobę");
    fireEvent.change(cap, { target: { value: "-5" } });

    expect(cap).toHaveAttribute("aria-invalid", "true");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Limit miesięczny musi być liczbą całkowitą ≥ 0.");
    expect(cap).toHaveAttribute("aria-describedby", expect.stringContaining(alert.id));
    expect(screen.getByRole("button", { name: "Zapisz konfigurację" })).toBeDisabled();

    fireEvent.change(cap, { target: { value: "50" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zapisz konfigurację" })).toBeEnabled();
  });

  it("saves the full body with updated_at after editing levels and a comma multiplier", async () => {
    vi.mocked(pointsApi.updatePointsConfig).mockResolvedValue({ ...CONFIG, updated_at: "2026-11-19T11:00:00" });
    renderPage();

    fireEvent.change(await screen.findByLabelText("Słaby"), { target: { value: "0,6" } });
    fireEvent.click(screen.getByRole("button", { name: "Usuń poziom 20" }));
    const add = screen.getByLabelText("Nowy poziom");
    fireEvent.change(add, { target: { value: "15" } });
    expect(fireEvent.keyDown(add, { key: "Enter" })).toBe(false);
    const chips = screen.getByRole("list", { name: "Dozwolone poziomy" });
    expect(within(chips).getAllByRole("listitem").map((li) => li.textContent?.replace("✕", "").trim())).toEqual([
      "0",
      "10",
      "15",
    ]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Zapisz konfigurację" }));
    });

    await waitFor(() =>
      expect(pointsApi.updatePointsConfig).toHaveBeenCalledWith({
        ...CONFIG,
        multiplier_poor: 0.6,
        attendance_levels: [0, 10, 15],
      }),
    );
    expect(await screen.findByText("Zapisano konfigurację.")).toBeInTheDocument();
  });

  it("shows the server's 409 message verbatim", async () => {
    const message = "Konfiguracja została zmieniona w międzyczasie. Odśwież stronę.";
    vi.mocked(pointsApi.updatePointsConfig).mockRejectedValue(
      new ApiError(409, "Conflict", { status: 409, error: "Conflict", message }),
    );
    renderPage();

    await screen.findByLabelText("Mała");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Zapisz konfigurację" }));
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });
});
