import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as pointsApi from "../api/points";
import type { PointsSummary } from "../api/points";
import { PointsReservationSheet } from "../features/product/PointsReservationSheet";
import type { TakeContext } from "../features/product/useItemTake";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/points", () => ({ getMyPoints: vi.fn() }));

const TERM: TakeContext = {
  kind: "TERM",
  id: "t1",
  name: "Wymiana na Mokotowie",
  starts_at: "2026-12-05T10:00:00",
  path: "/ania/group/g1/term/t1",
};

function summary(balance: number): PointsSummary {
  return { balance, held: 0, reputation: 0 };
}

function renderSheet(props: Partial<Parameters<typeof PointsReservationSheet>[0]> = {}) {
  const handlers = { onConfirm: vi.fn(), onRefresh: vi.fn(), onClose: vi.fn() };
  render(
    <PointsReservationSheet
      itemName="Rower dziecięcy 16″"
      price={60}
      target={TERM}
      locationName={null}
      busy={false}
      error={null}
      {...handlers}
      {...props}
    />,
    { wrapper: createQueryWrapper() },
  );
  return handlers;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("PointsReservationSheet", () => {
  it("shows the price, the available balance and the balance after, then reserves", async () => {
    vi.mocked(pointsApi.getMyPoints).mockResolvedValue(summary(140));
    const { onConfirm } = renderSheet();

    expect(await screen.findByText("140 pkt")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Biorę za punkty" })).toBeInTheDocument();
    expect(screen.getByText("Cena").nextSibling).toHaveTextContent("60 pkt");
    expect(screen.getByText("Dostępne saldo").nextSibling).toHaveTextContent("140 pkt");
    expect(screen.getByText("Po rezerwacji").nextSibling).toHaveTextContent("80 pkt");
    expect(screen.getByText(/odbiór: spotkanie „Wymiana na Mokotowie”, sob 5\.12/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Zablokuj 60 pkt i rezerwuj" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("blocks a short balance with the missing points as its hint", async () => {
    vi.mocked(pointsApi.getMyPoints).mockResolvedValue(summary(40));
    const { onConfirm } = renderSheet({ target: { kind: "PERSONAL" }, locationName: "Kęty" });

    const action = screen.getByRole("button", { name: "Zablokuj 60 pkt i rezerwuj" });
    expect(await screen.findByText("Brakuje Ci 20 pkt.")).toBeInTheDocument();
    expect(action).toHaveAttribute("aria-disabled", "true");
    expect(action).toHaveAccessibleDescription("Brakuje Ci 20 pkt.");
    expect(screen.queryByText("Po rezerwacji")).not.toBeInTheDocument();
    expect(screen.getByText(/odbiór osobisty · Kęty/)).toBeInTheDocument();

    fireEvent.click(action);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows a server refusal verbatim with Odśwież, which refreshes", async () => {
    vi.mocked(pointsApi.getMyPoints).mockResolvedValue(summary(140));
    const { onRefresh } = renderSheet({ error: "Cena zmieniła się — odśwież." });

    expect(screen.getByRole("alert")).toHaveTextContent("Cena zmieniła się — odśwież.");
    expect(screen.queryByRole("button", { name: "Zablokuj 60 pkt i rezerwuj" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Odśwież" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
