import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as pointsApi from "../api/points";
import type { PointHistoryEntry, PointTransactionType, PointsSummary } from "../api/points";
import type { Page } from "../api/pagination";
import { AccountView } from "../features/account/AccountView";
import { AccountPointsView } from "../features/points/AccountPointsView";
import { renderWithRoute } from "./renderWithRoute";
import { withQueryClient } from "./queryClient";

vi.mock("../api/points", () => ({
  getMyPoints: vi.fn(),
  getMyPointsHistory: vi.fn(),
}));

vi.mock("../features/panel/appDataStore", () => ({
  useAppData: () => ({
    profile: { party_id: "p-1" },
    organizationSlug: null,
    items: [],
    myGroups: [],
    logout: () => {},
  }),
}));
vi.mock("../hooks/useMyOrganization", () => ({ useMyOrganization: () => ({ data: null }) }));
vi.mock("../hooks/useMyReservations", () => ({ useMyReservations: () => ({ data: [], loading: false }) }));
vi.mock("../hooks/useWants", () => ({ useWants: () => ({ data: [], loading: false, error: null }) }));

function entry(overrides: Partial<PointHistoryEntry> = {}): PointHistoryEntry {
  return {
    id: "tx-1",
    type: "GIVE_FREE",
    amount: 40,
    reputation: 40,
    description: "Wózek spacerowy",
    counterparty_name: "Marta Nowak",
    occurred_at: "2026-11-18T10:00:00",
    ...overrides,
  };
}

function page(items: PointHistoryEntry[], pageNumber = 1, total = items.length, size = 20): Page<PointHistoryEntry> {
  return { items, total, page: pageNumber, size };
}

const SUMMARY: PointsSummary = { balance: 130, reputation: 80 };

function renderPoints() {
  return render(withQueryClient(<AccountPointsView />));
}

describe("AccountPointsView", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-19T12:00:00Z"));
    vi.mocked(pointsApi.getMyPoints).mockResolvedValue(SUMMARY);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the balance and reputation tiles under the owner-only header", async () => {
    vi.mocked(pointsApi.getMyPointsHistory).mockResolvedValue(page([entry()]));
    renderPoints();

    expect(screen.getByRole("heading", { level: 2, name: "Twoje punkty" })).toBeInTheDocument();
    expect(screen.getByText("Widzisz to tylko Ty.")).toBeInTheDocument();
    expect(await screen.findByText("130")).toBeInTheDocument();
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.getByText("punktów")).toBeInTheDocument();
    expect(screen.getByText("reputacji")).toBeInTheDocument();
    expect(screen.getByText(/Wydawanie punktów — wkrótce\./)).toBeInTheDocument();
    expect(screen.getByText(/^Jak zdobywać punkty:/)).toBeInTheDocument();
  });

  it.each<[PointTransactionType, Partial<PointHistoryEntry>, string, string, string, string]>([
    ["GIVE_FREE", { amount: 40, reputation: 40 }, "🎁", "Oddanie: Wózek spacerowy", "18 lis · Odbiorca: Marta Nowak", "+40"],
    [
      "WISHLIST_MATCH",
      { amount: 10, reputation: 0 },
      "🔎",
      "Bonus „Szukam”: Wózek spacerowy",
      "18 lis · rzecz z listy odbiorcy",
      "+10",
    ],
    [
      "EXCHANGE",
      { amount: 10, reputation: 0, description: "Kurtka zimowa ↔ Buty", counterparty_name: "Kasia W." },
      "🔄",
      "Wymiana: Kurtka zimowa ↔ Buty",
      "18 lis · Druga strona: Kasia W.",
      "+10",
    ],
    [
      "ATTENDANCE",
      { amount: 20, reputation: 0, description: "Grupa Mamy z Mokotowa", counterparty_name: null },
      "📍",
      "Obecność na terminie",
      "18 lis · Grupa Mamy z Mokotowa",
      "+20",
    ],
  ])("renders a %s history row", async (type, overrides, icon, title, subtitle, amount) => {
    vi.mocked(pointsApi.getMyPointsHistory).mockResolvedValue(page([entry({ type, ...overrides })]));
    renderPoints();

    const list = await screen.findByRole("list", { name: "Historia" });
    const row = within(list).getByRole("listitem");
    expect(within(row).getByText(icon)).toHaveAttribute("aria-hidden", "true");
    expect(within(row).getByText(title)).toBeInTheDocument();
    expect(row).toHaveTextContent(subtitle);
    expect(within(row).getByText(amount)).toBeInTheDocument();
    if (type === "GIVE_FREE") expect(row).toHaveTextContent(`${subtitle} · +40 reputacji`);
    else expect(row).not.toHaveTextContent("reputacji");
  });

  it("loads page 2 with „Pokaż starsze” and appends its rows", async () => {
    vi.mocked(pointsApi.getMyPointsHistory).mockImplementation(async (pageNumber) =>
      pageNumber === 1
        ? page([entry({ id: "tx-1", description: "Wózek" })], 1, 2, 1)
        : page([entry({ id: "tx-2", description: "Rower" })], 2, 2, 1),
    );
    renderPoints();

    fireEvent.click(await screen.findByRole("button", { name: "Pokaż starsze" }));

    expect(await screen.findByText("Oddanie: Rower")).toBeInTheDocument();
    expect(screen.getByText("Oddanie: Wózek")).toBeInTheDocument();
    expect(pointsApi.getMyPointsHistory).toHaveBeenLastCalledWith(2);
    expect(screen.queryByRole("button", { name: "Pokaż starsze" })).not.toBeInTheDocument();
  });

  it("shows the empty state without history", async () => {
    vi.mocked(pointsApi.getMyPointsHistory).mockResolvedValue(page([]));
    renderPoints();

    expect(await screen.findByText("Nie masz jeszcze żadnych punktów.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pokaż starsze" })).not.toBeInTheDocument();
  });

  it("shows the error state when the history fails", async () => {
    vi.mocked(pointsApi.getMyPointsHistory).mockRejectedValue(new ApiError(500, "Internal Server Error", { detail: "Błąd serwera", status: 500, title: "Błąd" }));
    renderPoints();

    expect(await screen.findByRole("alert")).toHaveTextContent("Błąd serwera");
  });
});

describe("AccountView points entry", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(pointsApi.getMyPoints).mockResolvedValue(SUMMARY);
  });

  it("shows the points and reputation tiles above the menu, linking to /points", async () => {
    renderWithRoute(withQueryClient(<AccountView />), { url: "/account" });

    const link = await screen.findByRole("link", { name: "Moje punkty: 130 punktów, 80 reputacji" });
    expect(link).toHaveTextContent("130 punktów");
    expect(link).toHaveTextContent("80 reputacji");
    expect(link).toHaveAttribute("href", "/points");
    expect(link.compareDocumentPosition(screen.getByRole("link", { name: "Mój profil" }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});
