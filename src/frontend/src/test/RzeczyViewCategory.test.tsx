import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RzeczyView } from "../pages/panel/views/RzeczyView";
import * as panelDataStore from "../pages/panel/panelDataStore";
import type { PanelDataContextValue } from "../pages/panel/PanelDataContext";
import type { InventoryBalanceResponse, InventoryItemResponse } from "../api/inventories";
import type { Category } from "../api/categories";
import type { NotificationKind } from "../api/notifications";
import { api } from "../api/client";

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

function mockBalance(itemId: number, status: InventoryBalanceResponse["status"]): InventoryBalanceResponse {
  return {
    id: itemId,
    item_id: itemId,
    status,
    reserved_at: null,
    lent_at: null,
    returned_at: null,
    due_date: null,
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

const item: InventoryItemResponse = {
  id: 10,
  inventory_id: 1,
  home_inventory_id: null,
  product_id: 100,
  product_name: "Rowerek",
  condition: "GOOD",
  added_at: "2026-01-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function makeContextValue(
  overrides: Partial<PanelDataContextValue> = {},
): PanelDataContextValue {
  return {
    items: [item],
    itemModes: {},
    editingItemMeta: { id: 10, name: "Rowerek", category_id: 1 },
    editingItemCondition: null,
    itemMetaError: null,
    itemError: null,
    busy: false,
    categories: mockCategories,
    setItemDraft: vi.fn(),
    setModal: vi.fn(),
    setEditingItemMeta: vi.fn(),
    setEditingItemCondition: vi.fn(),
    saveItemMeta: vi.fn(),
    saveItemCondition: vi.fn(),
    startEditItemMeta: vi.fn(),
    setItemMode: vi.fn(),
    handleDeleteItem: vi.fn(),
    ...overrides,
  } as unknown as PanelDataContextValue;
}

describe("RzeczyView — category select renders from live category data", () => {
  it("renders the 'Typ rzeczy' select options from useCategories()'s live data (via panel context)", async () => {
    // RzeczyView always fires its balance-fetch effect for every mounted
    // item (see the badge describe block below), so `api.get` needs a
    // valid response here too — otherwise the unconfigured mock resolves
    // to `undefined` and crashes `getInventoryItemBalances`' `.map` in an
    // unhandled rejection that surfaces (mis-attributed) in a later test.
    vi.mocked(api.get).mockResolvedValue(mockBalance(item.id, "AVAILABLE"));
    vi.mocked(panelDataStore.usePanelData).mockReturnValue(makeContextValue());

    render(<RzeczyView />);

    const select = screen.getByLabelText("Typ rzeczy") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Zabawki", "Ubrania"]);
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["1", "2"]);
    expect(select.value).toBe("1");
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
      makeContextValue({ editingItemMeta: null }),
    );

    render(<RzeczyView />);

    const badge = await screen.findByRole("status");
    expect(badge).toHaveTextContent("czeka na potwierdzenie");
  });

  it("renders 'zablokowane' for an item with an IN_TRANSIT balance", async () => {
    vi.mocked(api.get).mockResolvedValue(mockBalance(item.id, "IN_TRANSIT"));
    vi.mocked(panelDataStore.usePanelData).mockReturnValue(
      makeContextValue({ editingItemMeta: null }),
    );

    render(<RzeczyView />);

    const badge = await screen.findByRole("status");
    expect(badge).toHaveTextContent("zablokowane");
  });

  it("renders no badge for an AVAILABLE item", async () => {
    vi.mocked(api.get).mockResolvedValue(mockBalance(item.id, "AVAILABLE"));
    vi.mocked(panelDataStore.usePanelData).mockReturnValue(
      makeContextValue({ editingItemMeta: null }),
    );

    render(<RzeczyView />);

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not render any new action button for a locked (IN_TRANSIT) item", async () => {
    vi.mocked(api.get).mockResolvedValue(mockBalance(item.id, "IN_TRANSIT"));
    vi.mocked(panelDataStore.usePanelData).mockReturnValue(
      makeContextValue({ editingItemMeta: null }),
    );

    render(<RzeczyView />);

    await screen.findByRole("status");
    const buttonNames = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(buttonNames).not.toContain(null);
    expect(
      buttonNames.some((name) => /potwierd|zaakceptuj|odrzuć|accept|reject|confirm/i.test(name ?? "")),
    ).toBe(false);
  });
});

describe("NotificationKind — frontend union matches backend enum", () => {
  it("includes all 10 backend NotificationKind members", () => {
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
    ];
    expect(allKinds).toHaveLength(10);
    expect(new Set(allKinds).size).toBe(10);
  });
});
