import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { NeededItemResponse } from "../api/terms";
import type { PledgeResponse } from "../api/pledges";
import type { UseKragGrupyResult } from "../hooks/useKragGrupy";
import { KragGrupyPage } from "../pages/krag/KragGrupyPage";

const fulfillPledgeItem = vi.fn();

let hookValue: UseKragGrupyResult;

vi.mock("../hooks/useKragGrupy", () => ({
  useKragGrupy: () => hookValue,
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

const neededItem: NeededItemResponse = {
  id: 11,
  term_id: 1,
  product_id: 5,
  product_name: "Bębenek",
  product_category: "OTHER",
  description: "mały",
  created_at: "",
  updated_at: "",
};

const myClaimedPledge: PledgeResponse = {
  id: 91,
  needed_item_id: 11,
  pledged_by_party_id: 42,
  status: "CLAIMED",
  resolved_reservation_id: null,
  created_at: "",
  updated_at: "",
};

function baseHookValue(overrides: Partial<UseKragGrupyResult> = {}): UseKragGrupyResult {
  return {
    loading: false,
    error: null,
    group: { id: 1, name: "Grupa Nutki", organizer_party_id: 7 } as never,
    organizer: { party_id: 7, display_name: "Ola" } as never,
    families: [],
    myPartyId: 42,
    currentTerm: { id: 1, circle_group_id: 1, occurs_on: "2026-03-10", description: null } as never,
    neededItems: [{ item: neededItem, pledges: [myClaimedPledge] }],
    myAvailableItems: [],
    pledgeFamilyName: () => "Rodzina Testowa",
    pledge: vi.fn(),
    withdraw: vi.fn(),
    fulfillPledgeItem,
    confirmPledgeReceipt: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/krag/1"]}>
      <Routes>
        <Route path="/krag/:groupId" element={<KragGrupyPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hookValue = baseHookValue();
});

describe("KragGrupyPage (private view) — fulfill a pledge", () => {
  it("shows the needed item by its product_name", () => {
    renderPage();
    expect(screen.getByText(/Bębenek/)).toBeInTheDocument();
  });

  it("with no AVAILABLE items: 'nowa rzecz' mode, 'Z moich rzeczy' disabled, Zapisz → fulfillPledge({condition})", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Zarejestruj przedmiot" }));

    expect(screen.getByRole("button", { name: "Z moich rzeczy" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Nowa rzecz" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("Stan")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    await waitFor(() =>
      expect(fulfillPledgeItem).toHaveBeenCalledWith(91, { condition: "GOOD" }),
    );
  });

  it("with an AVAILABLE item: defaults to 'z moich rzeczy', Zapisz → fulfillPledge({inventory_item_id})", async () => {
    hookValue = baseHookValue({
      myAvailableItems: [{ id: 500, productName: "Mój bębenek" }],
    });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Zarejestruj przedmiot" }));

    expect(screen.getByRole("button", { name: "Z moich rzeczy" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("Rzecz z moich zbiorów")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    await waitFor(() =>
      expect(fulfillPledgeItem).toHaveBeenCalledWith(91, { inventory_item_id: 500 }),
    );
  });
});
