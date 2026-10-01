import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RzeczyView } from "../pages/panel/views/RzeczyView";
import * as panelDataStore from "../pages/panel/panelDataStore";
import type { PanelDataContextValue } from "../pages/panel/PanelDataContext";
import type { InventoryBalanceResponse, MyInventoryItemResponse } from "../api/inventories";
import type { ReservationResponse } from "../api/reservations";
import type { TermResponse } from "../api/terms";
import type { Category } from "../api/categories";
import type { NotificationKind } from "../api/notifications";
import { api } from "../api/client";
import * as reservationsApi from "../api/reservations";

// `confirmTransaction`/`cancelTransaction` (Bug #4c's "Odebrał"/"Anuluj
// wymianę" actions) go through `api.post`, which the `api/client` mock
// above does NOT stub — only `api.get` is replaced there. Mock these two
// directly instead, keeping every other export (incl. `getReservation`,
// which DOES go through the mocked `api.get`) real.
vi.mock("../api/reservations", async () => {
  const actual =
    await vi.importActual<typeof import("../api/reservations")>("../api/reservations");
  return { ...actual, confirmTransaction: vi.fn(), cancelTransaction: vi.fn() };
});

vi.mock("../pages/panel/panelDataStore", async () => {
  const actual = await vi.importActual<typeof import("../pages/panel/panelDataStore")>(
    "../pages/panel/panelDataStore",
  );
  return { ...actual, usePanelData: vi.fn() };
});

// `getInventoryItemBalances` (api/inventories.ts) calls the sibling
// `getInventoryItemBalance` from within the SAME module, so mocking that
// export via `vi.mock("../api/inventories", ...)` would not intercept the
// internal call (ESM same-module self-references bypass a mocked export
// binding). Mocking `api.get` at the `../api/client` layer instead — a
// genuine cross-module boundary — reliably intercepts every balance fetch.
vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { ...actual.api, get: vi.fn() } };
});

function mockBalance(
  itemId: number,
  status: InventoryBalanceResponse["status"],
  reservationId: number | null = null,
): InventoryBalanceResponse {
  return {
    id: itemId,
    item_id: itemId,
    status,
    reserved_at: null,
    lent_at: null,
    returned_at: null,
    due_date: null,
    reservation_id: reservationId,
  };
}

const mockCategories: Category[] = [
  {
    id: 1,
    name: "Zabawki",
    description: null,
    sortOrder: 0,
    productCount: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: 2,
    name: "Ubrania",
    description: null,
    sortOrder: 1,
    productCount: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

// Term/Group ids are UUID strings (spec R29).
const GROUP_ID = "5f0c2a7e-3b1d-4e6a-9c8f-0000000000a5";
const ENDED_TERM_ID = "9a0b1c2d-3e4f-4a5b-8c6d-0000000000c9";
const FUTURE_TERM_ID = "0b1c2d3e-4f5a-4b6c-8d7e-0000000000ca";

function mockReservation(id: number, termId: string): ReservationResponse {
  return {
    id,
    item_id: item.id,
    reservation_type: "LEND",
    reserved_by_user_id: 1,
    term_id: termId,
    paired_reservation_id: null,
    reserved_at: "",
    expires_at: null,
    status: "CONFIRMED",
    notes: null,
  };
}

function mockTerm(id: string, occursOn: string): TermResponse {
  return {
    id,
    circle_group_id: GROUP_ID,
    occurs_on: occursOn,
    description: null,
    created_at: "",
    updated_at: "",
    attendee_count: null,
    child_count: null,
  };
}

/** Routes `api.get` (the shared cross-module mock boundary — see the
 * comment above `vi.mock("../api/client", ...)`) to the balance/
 * reservation/term fixtures by URL substring, so the Bug #4c term-end
 * resolution effect (`getInventoryItemBalances` -> `getReservation` ->
 * `getTerm`) each land on the right fixture instead of all resolving to
 * the same value. */
function mockApiGetRouter(fixtures: {
  balance: InventoryBalanceResponse;
  reservation?: ReservationResponse;
  term?: TermResponse;
}) {
  vi.mocked(api.get).mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.includes("/balance")) return Promise.resolve(fixtures.balance);
    if (p.includes("/reservations/") && fixtures.reservation) {
      return Promise.resolve(fixtures.reservation);
    }
    if (p.includes("/terms/") && fixtures.term) {
      return Promise.resolve(fixtures.term);
    }
    return Promise.reject(new Error(`unexpected api.get(${p}) in test`));
  });
}

const item: MyInventoryItemResponse = {
  id: 10,
  inventory_id: 1,
  home_inventory_id: null,
  product_id: 100,
  product_name: "Rowerek",
  condition: "GOOD",
  added_at: "2026-01-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  listing_mode: null,
};

function makeContextValue(
  overrides: Partial<PanelDataContextValue> = {},
): PanelDataContextValue {
  return {
    items: [item],
    itemModes: {},
    itemError: null,
    busy: false,
    categories: mockCategories,
    setItemDraft: vi.fn(),
    setModal: vi.fn(),
    setItemMode: vi.fn(),
    handleDeleteItem: vi.fn(),
    load: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as PanelDataContextValue;
}

function renderView() {
  return render(
    <MemoryRouter>
      <RzeczyView />
    </MemoryRouter>,
  );
}

describe("RzeczyView — item card links to the item page", () => {
  it("renders view and edit links to /product/:id and no inline name, category or condition editors", async () => {
    // RzeczyView always fires its balance-fetch effect for every mounted
    // item (see the badge describe block below), so `api.get` needs a
    // valid response here too — otherwise the unconfigured mock resolves
    // to `undefined` and crashes `getInventoryItemBalances`' `.map` in an
    // unhandled rejection that surfaces (mis-attributed) in a later test.
    vi.mocked(api.get).mockResolvedValue(mockBalance(item.id, "AVAILABLE"));
    vi.mocked(panelDataStore.usePanelData).mockReturnValue(makeContextValue());

    renderView();

    expect(screen.getByRole("link", { name: "Zobacz rzecz Rowerek" })).toHaveAttribute(
      "href",
      `/product/${item.id}`,
    );
    expect(screen.getByRole("link", { name: "Edytuj rzecz Rowerek" })).toHaveAttribute(
      "href",
      `/product/${item.id}/edit`,
    );
    expect(screen.queryByRole("button", { name: "Edytuj stan rzeczy" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edytuj rzecz Rowerek" })).toBeNull();
    expect(screen.queryByLabelText("Typ rzeczy")).toBeNull();
    expect(screen.queryByLabelText("Stan rzeczy")).toBeNull();
    expect(screen.getByText("Stan: Dobry")).toBeInTheDocument();
    // Let the balance-fetch effect settle before the test (and its mocks)
    // tear down, so the state update lands inside this test's act() scope.
    await waitFor(() => expect(api.get).toHaveBeenCalled());
  });
});

describe("RzeczyView — passive lock/pending balance badge", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it("renders 'czeka na potwierdzenie' for an item with a RESERVED balance", async () => {
    vi.mocked(api.get).mockResolvedValue(mockBalance(item.id, "RESERVED"));
    vi.mocked(panelDataStore.usePanelData).mockReturnValue(
      makeContextValue(),
    );

    renderView();

    const badge = await screen.findByRole("status");
    expect(badge).toHaveTextContent("czeka na potwierdzenie");
  });

  it("renders 'zablokowane' for an item with an IN_TRANSIT balance", async () => {
    vi.mocked(api.get).mockResolvedValue(mockBalance(item.id, "IN_TRANSIT"));
    vi.mocked(panelDataStore.usePanelData).mockReturnValue(
      makeContextValue(),
    );

    renderView();

    const badge = await screen.findByRole("status");
    expect(badge).toHaveTextContent("zablokowane");
  });

  it("renders no badge for an AVAILABLE item", async () => {
    vi.mocked(api.get).mockResolvedValue(mockBalance(item.id, "AVAILABLE"));
    vi.mocked(panelDataStore.usePanelData).mockReturnValue(
      makeContextValue(),
    );

    renderView();

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not render any new action button for a locked (IN_TRANSIT) item", async () => {
    vi.mocked(api.get).mockResolvedValue(mockBalance(item.id, "IN_TRANSIT"));
    vi.mocked(panelDataStore.usePanelData).mockReturnValue(
      makeContextValue(),
    );

    renderView();

    await screen.findByRole("status");
    const buttonNames = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(buttonNames).not.toContain(null);
    expect(
      buttonNames.some((name) => /potwierd|zaakceptuj|odrzuć|accept|reject|confirm/i.test(name ?? "")),
    ).toBe(false);
  });
});

describe("RzeczyView — mode toggle buttons locked while a reservation is active (Bug #1)", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  function modeToggleButtons(): HTMLElement[] {
    return ["Wypożyczę", "Oddam", "Zamienię"].map((name) => screen.getByRole("button", { name }));
  }

  it("disables the three mode toggle buttons (native + aria-disabled) for a RESERVED item", async () => {
    vi.mocked(api.get).mockResolvedValue(mockBalance(item.id, "RESERVED"));
    vi.mocked(panelDataStore.usePanelData).mockReturnValue(
      makeContextValue(),
    );

    renderView();

    await screen.findByRole("status");
    for (const button of modeToggleButtons()) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("aria-disabled", "true");
    }
  });

  it("disables the three mode toggle buttons (native + aria-disabled) for an IN_TRANSIT item", async () => {
    vi.mocked(api.get).mockResolvedValue(mockBalance(item.id, "IN_TRANSIT"));
    vi.mocked(panelDataStore.usePanelData).mockReturnValue(
      makeContextValue(),
    );

    renderView();

    await screen.findByRole("status");
    for (const button of modeToggleButtons()) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("aria-disabled", "true");
    }
  });

  it("leaves the three mode toggle buttons enabled for an AVAILABLE item", async () => {
    vi.mocked(api.get).mockResolvedValue(mockBalance(item.id, "AVAILABLE"));
    vi.mocked(panelDataStore.usePanelData).mockReturnValue(
      makeContextValue(),
    );

    renderView();

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    for (const button of modeToggleButtons()) {
      expect(button).not.toBeDisabled();
      expect(button).not.toHaveAttribute("aria-disabled", "true");
    }
  });

  it("leaves the three mode toggle buttons enabled when the item has no balance entry yet (undefined)", () => {
    // Balance fetch left pending (never resolved) — `itemBalances` stays
    // `{}`, so `itemBalances[it.id]` is `undefined` for the whole test,
    // matching the "no balance entry yet" state without needing to await
    // an unhandled rejection.
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    vi.mocked(panelDataStore.usePanelData).mockReturnValue(
      makeContextValue(),
    );

    renderView();

    for (const button of modeToggleButtons()) {
      expect(button).not.toBeDisabled();
      expect(button).not.toHaveAttribute("aria-disabled", "true");
    }
  });
});

describe("RzeczyView — post-term-end fallback buttons (Bug #4c)", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(reservationsApi.confirmTransaction).mockReset();
    vi.mocked(reservationsApi.cancelTransaction).mockReset();
  });

  it("renders 'Odebrał' and 'Anuluj wymianę', full-word-labeled, immediately after the badge, when locked AND the term has ended", async () => {
    mockApiGetRouter({
      balance: mockBalance(item.id, "IN_TRANSIT", 55),
      reservation: mockReservation(55, ENDED_TERM_ID),
      term: mockTerm(ENDED_TERM_ID, "2020-01-01T10:00:00"), // long past
    });
    vi.mocked(panelDataStore.usePanelData).mockReturnValue(
      makeContextValue(),
    );

    renderView();

    const badge = await screen.findByRole("status");
    const odebral = await screen.findByRole("button", { name: "Odebrał" });
    const anuluj = await screen.findByRole("button", { name: "Anuluj wymianę" });

    // Full-word labels, no icon-only buttons.
    expect(odebral).toHaveTextContent("Odebrał");
    expect(anuluj).toHaveTextContent("Anuluj wymianę");
    // Primary (bg-mint) pill, same visual weight as "Zapisz".
    expect(odebral.className).toContain("bg-mint");
    // Tertiary text-danger pill — NOT the bare ghost "Anuluj" classes
    // (border border-line text-ink-soft) used by the edit-cancel buttons.
    expect(anuluj.className).toContain("text-danger");
    expect(anuluj.className).not.toContain("border-line");
    // Tab/DOM order: badge, then Odebrał, then Anuluj wymianę.
    const row = badge.parentElement as HTMLElement;
    const order = Array.from(row.children).map((el) => el.textContent);
    expect(order.indexOf(badge.textContent)).toBeLessThan(
      order.findIndex((t) => t === "Odebrał"),
    );
    expect(order.findIndex((t) => t === "Odebrał")).toBeLessThan(
      order.findIndex((t) => t === "Anuluj wymianę"),
    );
  });

  it("does not render the new buttons when locked but the term has NOT yet ended (Mockup 3)", async () => {
    mockApiGetRouter({
      balance: mockBalance(item.id, "RESERVED", 56),
      reservation: mockReservation(56, FUTURE_TERM_ID),
      term: mockTerm(FUTURE_TERM_ID, "2999-01-01T10:00:00"), // far future
    });
    vi.mocked(panelDataStore.usePanelData).mockReturnValue(
      makeContextValue(),
    );

    renderView();

    await screen.findByRole("status");
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(expect.stringContaining("/reservations/56")));
    expect(screen.queryByRole("button", { name: "Odebrał" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Anuluj wymianę" })).not.toBeInTheDocument();
  });

  it("does not render the new buttons for an AVAILABLE item (no active reservation)", async () => {
    mockApiGetRouter({ balance: mockBalance(item.id, "AVAILABLE", null) });
    vi.mocked(panelDataStore.usePanelData).mockReturnValue(
      makeContextValue(),
    );

    renderView();

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Odebrał" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Anuluj wymianę" })).not.toBeInTheDocument();
  });

  it("'Odebrał' calls confirmTransaction with the tile's reservation id only, then refreshes panel data", async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    mockApiGetRouter({
      balance: mockBalance(item.id, "IN_TRANSIT", 55),
      reservation: mockReservation(55, ENDED_TERM_ID),
      term: mockTerm(ENDED_TERM_ID, "2020-01-01T10:00:00"),
    });
    vi.mocked(reservationsApi.confirmTransaction).mockResolvedValue({
      reservation_id: 55,
      status: "FULFILLED",
      already_resolved: false,
    });
    vi.mocked(panelDataStore.usePanelData).mockReturnValue(
      makeContextValue({ load }),
    );

    renderView();

    const odebral = await screen.findByRole("button", { name: "Odebrał" });
    fireEvent.click(odebral);

    await waitFor(() =>
      expect(reservationsApi.confirmTransaction).toHaveBeenCalledWith(55),
    );
    await waitFor(() => expect(load).toHaveBeenCalledWith({ silent: true }));
  });

  it("'Anuluj wymianę' calls cancelTransaction with the tile's reservation id only, then refreshes panel data", async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    mockApiGetRouter({
      balance: mockBalance(item.id, "IN_TRANSIT", 55),
      reservation: mockReservation(55, ENDED_TERM_ID),
      term: mockTerm(ENDED_TERM_ID, "2020-01-01T10:00:00"),
    });
    vi.mocked(reservationsApi.cancelTransaction).mockResolvedValue({
      reservation_id: 55,
      status: "CANCELLED",
      already_resolved: false,
    });
    vi.mocked(panelDataStore.usePanelData).mockReturnValue(
      makeContextValue({ load }),
    );

    renderView();

    const anuluj = await screen.findByRole("button", { name: "Anuluj wymianę" });
    fireEvent.click(anuluj);

    await waitFor(() =>
      expect(reservationsApi.cancelTransaction).toHaveBeenCalledWith(55),
    );
    await waitFor(() => expect(load).toHaveBeenCalledWith({ silent: true }));
  });
});

describe("NotificationKind — frontend union matches backend enum", () => {
  it("includes all 11 backend NotificationKind members", () => {
    const allKinds: NotificationKind[] = [
      "PLEDGE_CREATED",
      "PLEDGE_WITHDRAWN",
      "PLEDGE_ITEM_REGISTERED",
      "NEEDED_ITEM_REMOVED",
      "TERM_ITEM_LISTING_TAKEN",
      "SWAP_PROPOSED",
      "SWAP_ACCEPTED",
      "SWAP_REJECTED",
      "TERM_CONFIRMATION_NEEDED",
      "TERM_ALREADY_RESOLVED",
      "ITEM_RESERVED_FOR_PICKUP",
    ];
    expect(allKinds).toHaveLength(11);
    expect(new Set(allKinds).size).toBe(11);
  });
});
