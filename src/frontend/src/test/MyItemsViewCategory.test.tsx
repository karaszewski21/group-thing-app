import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithRoute } from "./renderWithRoute";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MyItemsView } from "../features/items/MyItemsView";
import * as appDataStore from "../features/panel/appDataStore";
import type { AppDataContextValue } from "../features/panel/AppDataContext";
import type { MyInventoryItemResponse } from "../api/inventories";
import type { ReservationDetailResponse } from "../api/reservations";
import type { NotificationKind } from "../api/notifications";
import { api, ApiError } from "../api/client";
import * as reservationsApi from "../api/reservations";

// `confirmTransaction`/`cancelTransaction` (Bug #4c's "Odebrał"/"Anuluj
// wymianę" actions) go through `api.post`, which the `api/client` mock
// above does NOT stub — only `api.get` is replaced there. Mock these two
// directly instead, keeping every other export (incl. `getReservation`,
// which DOES go through the mocked `api.get`) real.
vi.mock("../hooks/useMyItemsPage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useMyItemsPage")>();
  const { useFakeMyItemsPage } = await import("./myItemsPageMock");
  return { ...actual, useMyItemsPage: useFakeMyItemsPage };
});

vi.mock("../api/reservations", async () => {
  const actual =
    await vi.importActual<typeof import("../api/reservations")>("../api/reservations");
  return { ...actual, confirmTransaction: vi.fn(), cancelTransaction: vi.fn() };
});

vi.mock("../features/panel/appDataStore", async () => {
  const actual = await vi.importActual<typeof import("../features/panel/appDataStore")>(
    "../features/panel/appDataStore",
  );
  return { ...actual, useAppData: vi.fn() };
});

// The reservation reads (`getReservation`) go through `api.get`; mocking it
// at the `../api/client` layer routes them to the fixtures below.
vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { ...actual.api, get: vi.fn() } };
});

/** `it` with the lock the server reports on each item at home. */
function withBalance(
  it: MyInventoryItemResponse,
  status: MyInventoryItemResponse["balance_status"],
  reservationId: string | null = null,
): MyInventoryItemResponse {
  return { ...it, balance_status: status, reservation_id: reservationId };
}

// Term/Group ids are UUID strings (spec R29).
const ENDED_TERM_ID = "9a0b1c2d-3e4f-4a5b-8c6d-0000000000c9";
const FUTURE_TERM_ID = "0b1c2d3e-4f5a-4b6c-8d7e-0000000000ca";

function mockReservation(
  id: string,
  termId: string,
  termOccursOn: string,
  itemId: string = item.id,
  reservationType: ReservationDetailResponse["reservation_type"] = "SWAP",
): ReservationDetailResponse {
  return {
    id,
    item_id: itemId,
    reservation_type: reservationType,
    reserved_by_user_id: "1",
    term_id: termId,
    // A paired leg: an unpaired SWAP leg is never confirmable or cancellable.
    paired_reservation_id: reservationType === "SWAP" ? `${id}-paired` : null,
    reserved_at: "",
    expires_at: null,
    status: "CONFIRMED",
    notes: null,
    term_occurs_on: termOccursOn,
    personal_pickup: false,
  };
}

/** Routes `api.get` (the shared cross-module mock boundary — see the
 * comment above `vi.mock("../api/client", ...)`) to the reservation
 * fixtures by URL substring, so the Bug #4c term-end resolution effect
 * (`getReservation` per locked item) lands on the right fixture. A
 * reservation id mapped to `null` fails its fetch. `GET /terms/{id}` always
 * answers 404, as it does for a soft-deleted group's Term — the view must
 * not depend on it. */
function mockApiGetRouter(fixtures: { reservations?: Record<string, ReservationDetailResponse | null> }) {
  vi.mocked(api.get).mockImplementation((path: unknown) => {
    const p = String(path);
    const reservationId = p.match(/\/reservations\/([^/?]+)$/)?.[1];
    if (reservationId && fixtures.reservations && reservationId in fixtures.reservations) {
      const reservation = fixtures.reservations[reservationId];
      return reservation
        ? Promise.resolve(reservation)
        : Promise.reject(new ApiError(500, "Internal Server Error", null));
    }
    if (p.includes("/terms/")) {
      return Promise.reject(new ApiError(404, "Not Found", null));
    }
    return Promise.reject(new Error(`unexpected api.get(${p}) in test`));
  });
}

const item: MyInventoryItemResponse = {
  id: "10",
  inventory_id: "1",
  home_inventory_id: null,
  product_id: "100",
  product_name: "Rowerek",
  condition: "GOOD",
  added_at: "2026-01-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  listing_mode: null,
  listing_visibility: null,
  listing_status: "DRAFT",
  photos_moderation_pending: false,
  location_id: "loc-1",
  balance_status: "AVAILABLE",
  reservation_id: null,
};

const pendingItem: MyInventoryItemResponse = { ...item, photos_moderation_pending: true };

function makeContextValue(
  overrides: Partial<AppDataContextValue> = {},
): AppDataContextValue {
  return {
    items: [item],
    itemModes: {},
    itemError: null,
    ownSlug: "ania",
    busy: false,
    setItemMode: vi.fn(),
    handleDeleteItem: vi.fn(),
    load: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as AppDataContextValue;
}

function renderView() {
  return renderWithRoute(<MyItemsView />, { url: "/" });
}

describe("MyItemsView — item card links to the item page", () => {
  it("links the card under the user's own prefix, here a party id", async () => {
    vi.mocked(appDataStore.useAppData).mockReturnValue(
      makeContextValue({ ownSlug: "p-ania" }),
    );

    renderView();

    expect(screen.getByRole("link", { name: "Zobacz rzecz Rowerek" })).toHaveAttribute(
      "href",
      `/p-ania/product/${item.id}`,
    );
  });

  it("links the card to /:slug/product/:id, edit to the panel, and has no inline editors", async () => {
    vi.mocked(appDataStore.useAppData).mockReturnValue(makeContextValue());

    renderView();

    expect(screen.getByRole("link", { name: "Zobacz rzecz Rowerek" })).toHaveAttribute(
      "href",
      `/ania/product/${item.id}`,
    );
    expect(screen.getByRole("link", { name: "Edytuj rzecz Rowerek" })).toHaveAttribute(
      "href",
      `/items/${item.id}/edit`,
    );
    expect(screen.queryByRole("button", { name: "Edytuj stan rzeczy" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edytuj rzecz Rowerek" })).toBeNull();
    expect(screen.queryByLabelText("Typ rzeczy")).toBeNull();
    expect(screen.queryByLabelText("Stan rzeczy")).toBeNull();
    expect(screen.getByText("Stan: Dobry")).toBeInTheDocument();
  });
});

describe("MyItemsView — passive lock/pending balance badge", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it("renders 'czeka na potwierdzenie' for an item with a RESERVED balance", async () => {
    vi.mocked(appDataStore.useAppData).mockReturnValue(
      makeContextValue({ items: [withBalance(item, "RESERVED")] }),
    );

    renderView();

    const badge = await screen.findByRole("status");
    expect(badge).toHaveTextContent("czeka na potwierdzenie");
  });

  it("renders 'zablokowane' for an item with an IN_TRANSIT balance", async () => {
    vi.mocked(appDataStore.useAppData).mockReturnValue(
      makeContextValue({ items: [withBalance(item, "IN_TRANSIT")] }),
    );

    renderView();

    const badge = await screen.findByRole("status");
    expect(badge).toHaveTextContent("zablokowane");
  });

  it("renders no badge for an AVAILABLE item", async () => {
    vi.mocked(appDataStore.useAppData).mockReturnValue(
      makeContextValue(),
    );

    renderView();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not render any new action button for a locked (IN_TRANSIT) item", async () => {
    vi.mocked(appDataStore.useAppData).mockReturnValue(
      makeContextValue({ items: [withBalance(item, "IN_TRANSIT")] }),
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

describe("MyItemsView — mode toggle buttons locked while a reservation is active (Bug #1)", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  function modeToggleButtons(): HTMLElement[] {
    return ["Oddam", "Zamienię"].map((name) => screen.getByRole("button", { name }));
  }

  it("disables the two mode toggle buttons (native + aria-disabled) for a RESERVED item", async () => {
    vi.mocked(appDataStore.useAppData).mockReturnValue(
      makeContextValue({ items: [withBalance(item, "RESERVED")] }),
    );

    renderView();

    await screen.findByRole("status");
    for (const button of modeToggleButtons()) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("aria-disabled", "true");
    }
  });

  it("disables the two mode toggle buttons (native + aria-disabled) for an IN_TRANSIT item", async () => {
    vi.mocked(appDataStore.useAppData).mockReturnValue(
      makeContextValue({ items: [withBalance(item, "IN_TRANSIT")] }),
    );

    renderView();

    await screen.findByRole("status");
    for (const button of modeToggleButtons()) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("aria-disabled", "true");
    }
  });

  it("leaves the two mode toggle buttons enabled for an AVAILABLE item", async () => {
    vi.mocked(appDataStore.useAppData).mockReturnValue(
      makeContextValue(),
    );

    renderView();

    for (const button of modeToggleButtons()) {
      expect(button).not.toBeDisabled();
      expect(button).not.toHaveAttribute("aria-disabled", "true");
    }
  });
});

describe("MyItemsView — post-term-end fallback buttons (Bug #4c)", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(reservationsApi.confirmTransaction).mockReset();
    vi.mocked(reservationsApi.cancelTransaction).mockReset();
  });

  it("renders 'Odebrał' and 'Anuluj wymianę', full-word-labeled, immediately after the badge, when locked AND the term has ended", async () => {
    mockApiGetRouter({
      reservations: { "55": mockReservation("55", ENDED_TERM_ID, "2020-01-01T10:00:00") }, // long past
    });
    vi.mocked(appDataStore.useAppData).mockReturnValue(
      makeContextValue({ items: [withBalance(item, "IN_TRANSIT", "55")] }),
    );

    renderView();

    const badge = await screen.findByRole("status");
    const odebral = await screen.findByRole("button", { name: "Odebrał" });
    const anuluj = await screen.findByRole("button", { name: "Anuluj wymianę" });

    // Full-word labels, no icon-only buttons.
    expect(odebral).toHaveTextContent("Odebrał");
    expect(anuluj).toHaveTextContent("Anuluj wymianę");
    // Primary (bg-primary) pill, same visual weight as "Zapisz".
    expect(odebral.className).toContain("bg-primary");
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
      reservations: { "56": mockReservation("56", FUTURE_TERM_ID, "2999-01-01T10:00:00") }, // far future
    });
    vi.mocked(appDataStore.useAppData).mockReturnValue(
      makeContextValue({ items: [withBalance(item, "RESERVED", "56")] }),
    );

    renderView();

    await screen.findByRole("status");
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(expect.stringContaining("/reservations/56")));
    expect(screen.queryByRole("button", { name: "Odebrał" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Anuluj wymianę" })).not.toBeInTheDocument();
  });

  it("keeps 'Odebrał'/'Anuluj wymianę' for a soft-deleted group's term and for the other locked items when one reservation fetch fails", async () => {
    const deletedGroupItem = { ...item, id: "11", product_name: "Hulajnoga" };
    const failingItem = { ...item, id: "12", product_name: "Fotelik" };
    mockApiGetRouter({
      reservations: {
        "55": mockReservation("55", ENDED_TERM_ID, "2020-01-01T10:00:00"),
        // Its Term's group is soft-deleted: `GET /terms/{id}` answers 404,
        // the reservation still carries the date.
        "57": mockReservation("57", FUTURE_TERM_ID, "2020-02-01T10:00:00", deletedGroupItem.id),
        "58": null,
      },
    });
    vi.mocked(appDataStore.useAppData).mockReturnValue(
      makeContextValue({
        items: [
          withBalance(item, "IN_TRANSIT", "55"),
          withBalance(deletedGroupItem, "IN_TRANSIT", "57"),
          withBalance(failingItem, "IN_TRANSIT", "58"),
        ],
      }),
    );

    renderView();

    await waitFor(() => expect(screen.getAllByRole("button", { name: "Odebrał" })).toHaveLength(2));
    expect(screen.getAllByRole("button", { name: "Anuluj wymianę" })).toHaveLength(2);
    expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining("/terms/"));
  });

  it("offers the giver of an ended GIFT only 'Anuluj wymianę' — the recipient confirms receipt", async () => {
    mockApiGetRouter({
      reservations: { "55": mockReservation("55", ENDED_TERM_ID, "2020-01-01T10:00:00", item.id, "GIFT") },
    });
    vi.mocked(appDataStore.useAppData).mockReturnValue(
      makeContextValue({ items: [withBalance(item, "IN_TRANSIT", "55")] }),
    );

    renderView();

    expect(await screen.findByRole("button", { name: "Anuluj wymianę" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Odebrał" })).not.toBeInTheDocument();
  });

  it("does not render the new buttons for an AVAILABLE item (no active reservation)", async () => {
    vi.mocked(appDataStore.useAppData).mockReturnValue(
      makeContextValue(),
    );

    renderView();

    expect(screen.queryByRole("button", { name: "Odebrał" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Anuluj wymianę" })).not.toBeInTheDocument();
  });

  it("'Odebrał' calls confirmTransaction with the tile's reservation id only, then refreshes panel data", async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    mockApiGetRouter({
      reservations: { "55": mockReservation("55", ENDED_TERM_ID, "2020-01-01T10:00:00") },
    });
    vi.mocked(reservationsApi.confirmTransaction).mockResolvedValue({
      reservation_id: "55",
      status: "FULFILLED",
      already_resolved: false,
    });
    vi.mocked(appDataStore.useAppData).mockReturnValue(
      makeContextValue({ load, items: [withBalance(item, "IN_TRANSIT", "55")] }),
    );

    renderView();

    const odebral = await screen.findByRole("button", { name: "Odebrał" });
    fireEvent.click(odebral);

    await waitFor(() =>
      expect(reservationsApi.confirmTransaction).toHaveBeenCalledWith("55"),
    );
    await waitFor(() => expect(load).toHaveBeenCalledWith({ silent: true }));
  });

  it("'Anuluj wymianę' calls cancelTransaction with the tile's reservation id only, then refreshes panel data", async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    mockApiGetRouter({
      reservations: { "55": mockReservation("55", ENDED_TERM_ID, "2020-01-01T10:00:00") },
    });
    vi.mocked(reservationsApi.cancelTransaction).mockResolvedValue({
      reservation_id: "55",
      status: "CANCELLED",
      already_resolved: false,
    });
    vi.mocked(appDataStore.useAppData).mockReturnValue(
      makeContextValue({ load, items: [withBalance(item, "IN_TRANSIT", "55")] }),
    );

    renderView();

    const anuluj = await screen.findByRole("button", { name: "Anuluj wymianę" });
    fireEvent.click(anuluj);

    await waitFor(() =>
      expect(reservationsApi.cancelTransaction).toHaveBeenCalledWith("55"),
    );
    await waitFor(() => expect(load).toHaveBeenCalledWith({ silent: true }));
  });
});

describe("MyItemsView — photos in moderation do not block the mode toggles", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  function modeToggleButtons(): HTMLElement[] {
    return ["Oddam", "Zamienię"].map((name) => screen.getByRole("button", { name }));
  }

  it("pending → toggles enabled with no hint, the pill and the edit link stay", async () => {
    const setItemMode = vi.fn();
    vi.mocked(appDataStore.useAppData).mockReturnValue(
      makeContextValue({ items: [pendingItem], setItemMode }),
    );

    renderView();

    for (const button of modeToggleButtons()) {
      expect(button).toBeEnabled();
      expect(button).not.toHaveAttribute("aria-describedby");
    }
    expect(screen.queryByText(/Tryb włączysz po zatwierdzeniu zdjęć/)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Zdjęcia w moderacji");
    expect(screen.getByRole("link", { name: "Zobacz zdjęcia →" })).toHaveAttribute(
      "href",
      `/items/${item.id}/edit`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Oddam" }));
    expect(setItemMode).toHaveBeenCalledWith(item.id, "oddam");
  });

  it("locked + pending → both pills, lock pill first, toggles disabled by the lock only", async () => {
    mockApiGetRouter({
      reservations: { "55": mockReservation("55", ENDED_TERM_ID, "2020-01-01T10:00:00") },
    });
    vi.mocked(appDataStore.useAppData).mockReturnValue(
      makeContextValue({ items: [withBalance(pendingItem, "IN_TRANSIT", "55")] }),
    );

    renderView();

    expect(await screen.findByRole("button", { name: "Odebrał" })).toBeInTheDocument();
    const pills = screen.getAllByRole("status").map((el) => el.textContent);
    expect(pills).toEqual(["zablokowane", "Zdjęcia w moderacji"]);
    for (const button of modeToggleButtons()) {
      expect(button).toBeDisabled();
      expect(button).not.toHaveAttribute("aria-describedby");
    }
  });

  it("not pending → toggles enabled, no pill", async () => {
    vi.mocked(appDataStore.useAppData).mockReturnValue(makeContextValue());

    renderView();

    for (const button of modeToggleButtons()) expect(button).toBeEnabled();
    expect(screen.queryByText("Zdjęcia w moderacji")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Zobacz zdjęcia →" })).not.toBeInTheDocument();
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

describe("MyItemsView — no gift limit", () => {
  const items = Array.from({ length: 11 }, (_, index) => ({
    ...item,
    id: String(index + 1),
    product_name: `Rzecz ${index + 1}`,
  }));

  it("keeps Oddam enabled on every item however many are already gifted", async () => {
    const itemModes = Object.fromEntries(items.slice(0, 10).map((i) => [i.id, "oddam" as const]));
    vi.mocked(appDataStore.useAppData).mockReturnValue(makeContextValue({ items, itemModes }));

    renderView();

    expect(screen.queryByText(/Do oddania/)).not.toBeInTheDocument();
    for (const button of screen.getAllByRole("button", { name: "Oddam" })) {
      expect(button).toBeEnabled();
    }
  });
});
