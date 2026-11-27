import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ItemEditView } from "../features/items/ItemEditView";
import * as itemsApi from "../api/items";
import * as inventoriesApi from "../api/inventories";
import * as categoriesApi from "../api/categories";
import * as locationsApi from "../api/locations";
import * as itemActionsApi from "../api/itemActions";
import * as pointsApi from "../api/points";
import * as listingApi from "../api/itemListingPreferences";
import { ApiError } from "../api/client";
import type { ItemActionsResponse } from "../api/itemActions";
import type { Category } from "../api/categories";
import type { InventoryItemResponse } from "../api/inventories";
import type { ItemDetailsResponse } from "../api/items";
import { ITEM_ACTIONS_KEY } from "../hooks/useItemActions";
import { ITEM_DETAILS_KEY } from "../hooks/useItemDetail";
import { useAppNavigate } from "../routing/navigation";
import type { PickedLocationState } from "../utils/appHelpers";
import { makeLocality, makeLocationResponse } from "./fixtures/locations";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";
import { getTestLocation, getTestRouter, renderWithRoute } from "./renderWithRoute";

/** A stand-in for the panel's AppDataContext: `itemEdit` lives outside the
 * page, so it survives the page's unmount during the /places/new trip. */
const panel = vi.hoisted(() => {
  let state: Record<string, unknown> = {};
  const listeners = new Set<() => void>();
  function set(key: string, next: unknown) {
    state = { ...state, [key]: next };
    listeners.forEach((listener) => listener());
  }
  return {
    reset(initial: Record<string, unknown>) {
      state = initial;
    },
    get: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setters: { setItemEdit: (next: unknown) => set("itemEdit", next) },
  };
});

/* A clear renders at once, before the page's leave navigation lands — as in
 * the browser, where `history.back()` completes later — so a page that
 * re-seeds a cleared draft while still mounted is caught. */
vi.mock("../features/panel/appDataStore", async () => {
  const { useSyncExternalStore } = await import("react");
  const { flushSync } = await import("react-dom");
  const setItemEdit = (next: unknown) => {
    if (next === null) flushSync(() => panel.setters.setItemEdit(next));
    else panel.setters.setItemEdit(next);
  };
  return {
    useAppData: () => ({ ...useSyncExternalStore(panel.subscribe, panel.get), setItemEdit }),
  };
});

vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: "token-a" }) }));

vi.mock("../api/items", () => ({ getItemDetails: vi.fn() }));

vi.mock("../api/inventories", () => ({ updateInventoryItem: vi.fn() }));

vi.mock("../api/products", () => ({
  resolveProduct: vi.fn(),
  addProductPhoto: vi.fn(),
  deleteProductPhoto: vi.fn(),
  reorderProductPhotos: vi.fn(),
  updateProductDescription: vi.fn(),
}));

vi.mock("../api/categories", () => ({ getCategories: vi.fn() }));

vi.mock("../api/itemActions", () => ({ getItemActions: vi.fn() }));

vi.mock("../api/points", () => ({ getItemPointsValue: vi.fn(), getOwnedItemPointsValue: vi.fn() }));

vi.mock("../api/itemListingPreferences", () => ({ setItemListingPreference: vi.fn() }));

vi.mock("../api/locations", () => ({
  getMyLocations: vi.fn(),
  createLocation: vi.fn(),
  updateLocation: vi.fn(),
  deleteLocation: vi.fn(),
}));

const ITEM_ID = "5d7e9f10-2a3b-4c4d-8e5f-6a7b8c9d0e1f";
const PRODUCT_ID = "6e8f0a21-3b4c-4d5e-9f60-7b8c9d0e1f2a";
const CAT_KIDS = "6f801a21-3b4c-4d5e-8f60-7b8c9d0e1f2a";
const CAT_STROLLERS = "7f901b32-4c5d-4e6f-8a71-8c9d0e1f2a3b";
const EDIT_URL = `/items/${ITEM_ID}/edit`;
const ITEM_URL = `/ania/product/${ITEM_ID}`;

const KETY = makeLocationResponse();
const POZNAN = makeLocationResponse({
  id: "loc-2",
  locality: makeLocality({ id: "0969400", name: "Poznań", gmina: "Poznań", powiat: "Poznań", voivodeship: "wielkopolskie" }),
  label: "Poznań, wielkopolskie",
});

function category(id: string, name: string, parent_id: string | null): Category {
  return { id, name, description: null, parent_id, sort_order: 0, product_count: 0, size_class: null, created_at: "", updated_at: "" };
}

function details(overrides: Partial<ItemDetailsResponse> = {}): ItemDetailsResponse {
  return {
    id: ITEM_ID,
    product_id: PRODUCT_ID,
    name: "Wózek spacerowy",
    category_id: CAT_STROLLERS,
    category_name: "Wózki",
    condition: "GOOD",
    description: null,
    photos: [],
    product_photo_url: null,
    is_owner: true,
    location_id: KETY.id,
    deleted_at: null,
    listing_status: "DRAFT",
    status: { code: "AVAILABLE", term_occurs_on: null, due_date: null, counterparty_label: null, personal_pickup: false },
    ...overrides,
  };
}

function savedItem(): InventoryItemResponse {
  return {
    id: ITEM_ID,
    inventory_id: "inv-1",
    owner_inventory_id: "inv-1",
    product_id: PRODUCT_ID,
    product_name: "Wózek spacerowy",
    condition: "GOOD",
    listing_status: "DRAFT",
    added_at: "2026-10-01T10:00:00",
    created_at: "2026-10-01T10:00:00",
    updated_at: "2026-10-01T10:00:00",
  };
}

function actions(overrides: Partial<ItemActionsResponse> = {}): ItemActionsResponse {
  return {
    mode: "GIFT",
    points_price: null,
    visibility: "PUBLIC",
    available: true,
    reservation: null,
    party_reservation: null,
    owner: { party_id: "party-ania", display_name: "Ania", slug: "ania", items_total: 1 },
    viewer: "OWN",
    location: null,
    contexts: [],
    personal_pickup_available: false,
    ...overrides,
  };
}

function pointsActions(overrides: Partial<ItemActionsResponse> = {}): ItemActionsResponse {
  return actions({ mode: "POINTS", points_price: 40, ...overrides });
}

/** `/places/new` standing in for PlaceCreateView: saving returns to the
 * edit page, replacing this entry, with the new place picked. */
function PlaceCreateProbe() {
  const navigate = useAppNavigate();
  const state: PickedLocationState = { pickedLocation: { picker: "item-edit-place", locationId: POZNAN.id } };
  return (
    <button type="button" onClick={() => navigate(EDIT_URL, { replace: true, state })}>
      Zapisz miejsce
    </button>
  );
}

function renderEditPage(url = EDIT_URL, client: QueryClient = createTestQueryClient()) {
  return renderWithRoute(<ItemEditView />, {
    url,
    pattern: "/items/:id/edit",
    routes: {
      "/items": <p>Moje rzeczy</p>,
      "/ania/product/:id": <p>Strona rzeczy</p>,
      "/places/new": <PlaceCreateProbe />,
    },
    wrapper: createQueryWrapper(client),
  });
}

async function editForm() {
  return screen.findByRole("form", { name: "Edycja rzeczy" });
}

function placeSelect() {
  return screen.getByRole("combobox", { name: "Lokalizacja" });
}

beforeEach(() => {
  vi.resetAllMocks();
  panel.reset({ ownSlug: "ania", itemEdit: null, refreshItems: vi.fn(async () => {}) });
  vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details());
  vi.mocked(categoriesApi.getCategories).mockResolvedValue([
    category(CAT_KIDS, "Dzieci", null),
    category(CAT_STROLLERS, "Wózki", CAT_KIDS),
  ]);
  vi.mocked(locationsApi.getMyLocations).mockResolvedValue([KETY, POZNAN]);
  vi.mocked(inventoriesApi.updateInventoryItem).mockResolvedValue(savedItem());
  vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(actions());
  // The stored value (GOOD): 40 → 20–60; the draft forecast (LIKE_NEW): 60 → 30–90.
  vi.mocked(pointsApi.getOwnedItemPointsValue).mockResolvedValue({
    points_value: 40,
    price_min: 20,
    price_max: 60,
    price_step: 10,
  });
  vi.mocked(pointsApi.getItemPointsValue).mockImplementation(async (_categoryId, condition) =>
    condition === "GOOD"
      ? { points_value: 40, price_min: 20, price_max: 60, price_step: 10 }
      : { points_value: 60, price_min: 30, price_max: 90, price_step: 10 },
  );
  vi.mocked(listingApi.setItemListingPreference).mockResolvedValue(null);
});

describe("ItemEditView", () => {
  it("saves a changed place and refreshes the item details, the item actions and the panel's items", async () => {
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    renderEditPage(EDIT_URL, client);
    const form = await editForm();
    await waitFor(() => expect(placeSelect()).toHaveValue(KETY.id));
    expect(within(form).getByText("Kupujący zobaczą tylko miejscowość. Adres widzisz tylko Ty.")).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.change(placeSelect(), { target: { value: POZNAN.id } });
    fireEvent.click(within(form).getByRole("button", { name: "Zapisz zmiany" }));

    expect(await screen.findByText("Moje rzeczy")).toBeInTheDocument();
    expect(inventoriesApi.updateInventoryItem).toHaveBeenCalledTimes(1);
    expect(inventoriesApi.updateInventoryItem).toHaveBeenCalledWith(ITEM_ID, { location_id: POZNAN.id });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [ITEM_DETAILS_KEY] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [ITEM_ACTIONS_KEY] });
    expect(panel.get().refreshItems).toHaveBeenCalled();
    expect(panel.get().itemEdit).toBeNull();
  });

  it("an item without a live place shows the banner and an empty picker, and saves nothing until a place is picked", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details({ location_id: null }));
    renderEditPage();
    const form = await editForm();

    expect(screen.getByRole("status")).toHaveTextContent("Ustaw lokalizację, aby wystawić przedmiot.");
    await waitFor(() => expect(within(placeSelect()).getAllByRole("option")).toHaveLength(3));
    expect(placeSelect()).toHaveValue("");

    fireEvent.click(within(form).getByRole("button", { name: "Zapisz zmiany" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Wybierz lokalizację");
    expect(placeSelect()).toHaveAttribute("aria-invalid", "true");
    expect(inventoriesApi.updateInventoryItem).not.toHaveBeenCalled();
    expect(screen.queryByText("Moje rzeczy")).not.toBeInTheDocument();

    fireEvent.change(placeSelect(), { target: { value: KETY.id } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(within(form).getByRole("button", { name: "Zapisz zmiany" }));
    await waitFor(() =>
      expect(inventoriesApi.updateInventoryItem).toHaveBeenCalledWith(ITEM_ID, { location_id: KETY.id }),
    );
  });

  it("a place deleted from the caller's list counts as no place: inline error instead of a save", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details({ location_id: "loc-deleted" }));
    renderEditPage();
    const form = await editForm();
    await waitFor(() => expect(within(placeSelect()).getAllByRole("option")).toHaveLength(3));

    fireEvent.change(within(form).getByLabelText("Nazwa"), { target: { value: "Wózek głęboki" } });
    fireEvent.click(within(form).getByRole("button", { name: "Zapisz zmiany" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Wybierz lokalizację");
    expect(placeSelect()).toHaveAttribute("aria-invalid", "true");
    expect(inventoriesApi.updateInventoryItem).not.toHaveBeenCalled();
    expect(screen.queryByText("Moje rzeczy")).not.toBeInTheDocument();
  });

  it("Anuluj clears the kept draft and leaves without saving", async () => {
    renderEditPage();
    const form = await editForm();
    fireEvent.change(within(form).getByLabelText("Nazwa"), { target: { value: "Inna nazwa" } });
    expect(panel.get().itemEdit).toMatchObject({ itemId: ITEM_ID, draft: { name: "Inna nazwa" } });

    fireEvent.click(within(form).getByRole("button", { name: "Anuluj" }));

    expect(await screen.findByText("Moje rzeczy")).toBeInTheDocument();
    expect(panel.get().itemEdit).toBeNull();
    expect(inventoriesApi.updateInventoryItem).not.toHaveBeenCalled();
  });

  it("a visit after Anuluj seeds a fresh draft from the item, once", async () => {
    renderEditPage();
    const form = await editForm();
    fireEvent.change(within(form).getByLabelText("Nazwa"), { target: { value: "Inna nazwa" } });
    fireEvent.click(within(form).getByRole("button", { name: "Anuluj" }));
    await screen.findByText("Moje rzeczy");
    expect(panel.get().itemEdit).toBeNull();

    act(() => getTestRouter().navigate(EDIT_URL));

    const again = await editForm();
    expect(within(again).getByLabelText("Nazwa")).toHaveValue("Wózek spacerowy");
    expect(panel.get().itemEdit).toMatchObject({ itemId: ITEM_ID, draft: { name: "Wózek spacerowy" } });
  });

  it("keeps the draft across the + → /places/new → back trip and Zapisz goes back past it", async () => {
    renderEditPage(ITEM_URL);
    act(() => getTestRouter().navigate(EDIT_URL));
    const form = await editForm();
    await waitFor(() => expect(placeSelect()).toHaveValue(KETY.id));
    fireEvent.change(within(form).getByLabelText("Stan"), { target: { value: "LIKE_NEW" } });

    fireEvent.click(screen.getByRole("link", { name: "Dodaj nowe miejsce" }));
    fireEvent.click(await screen.findByRole("button", { name: "Zapisz miejsce" }));

    const back = await editForm();
    expect(within(back).getByLabelText("Stan")).toHaveValue("LIKE_NEW");
    await waitFor(() => expect(placeSelect()).toHaveValue(POZNAN.id));
    expect(placeSelect()).toHaveFocus();

    fireEvent.click(within(back).getByRole("button", { name: "Zapisz zmiany" }));

    expect(await screen.findByText("Strona rzeczy")).toBeInTheDocument();
    expect(inventoriesApi.updateInventoryItem).toHaveBeenCalledWith(ITEM_ID, { condition: "LIKE_NEW" });
    expect(inventoriesApi.updateInventoryItem).toHaveBeenCalledWith(ITEM_ID, { location_id: POZNAN.id });
    const calls = getTestRouter().calls;
    expect(calls.filter((c) => c.method === "push").map((c) => c.url)).toEqual([EDIT_URL]);
    expect(calls.filter((c) => c.method === "replace").map((c) => c.url?.split("?")[0])).toEqual([
      "/places/new",
      EDIT_URL,
    ]);
    expect(calls.at(-1)?.method).toBe("back");
    expect(getTestLocation().pathname).toBe(ITEM_URL);
  });
});

describe("ItemEditView — POINTS price", () => {
  async function priceInput() {
    return screen.findByRole("textbox", { name: "Cena w punktach" });
  }

  it("shows no price section for a listing that is not POINTS", async () => {
    renderEditPage();
    await editForm();
    await waitFor(() => expect(itemActionsApi.getItemActions).toHaveBeenCalled());
    expect(screen.queryByRole("textbox", { name: "Cena w punktach" })).not.toBeInTheDocument();
    expect(pointsApi.getOwnedItemPointsValue).not.toHaveBeenCalled();
  });

  it("uses the stored value's bounds while the category and condition are unchanged", async () => {
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(pointsActions());
    renderEditPage();

    expect(await priceInput()).toHaveValue("40");
    expect(screen.getByText("Dozwolone 20–60 pkt, co 10")).toBeInTheDocument();
    expect(pointsApi.getOwnedItemPointsValue).toHaveBeenCalledWith(ITEM_ID);
    expect(screen.queryByText(/Zmieniłeś/)).not.toBeInTheDocument();
  });

  it("after a condition change shows the forecast and the preview bounds", async () => {
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(pointsActions());
    renderEditPage();
    const form = await editForm();
    await priceInput();

    fireEvent.change(within(form).getByLabelText("Stan"), { target: { value: "LIKE_NEW" } });

    expect(
      await screen.findByText(
        "Zmieniłeś stan — sugestia to teraz 60 pkt (dozwolone 30–90). Twoja cena 40 pkt mieści się w zakresie.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Dozwolone 30–90 pkt, co 10")).toBeInTheDocument();
  });

  it("while reserved says the reservation settles at its held amount", async () => {
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(
      pointsActions({
        available: false,
        reservation: { by_name: "Ania", by_me: false },
        party_reservation: {
          role: "GIVER",
          reservation_id: "res-1",
          proposal_id: null,
          reservation_type: "POINTS",
          personal_pickup: true,
          can_confirm: false,
          can_cancel: true,
          can_accept: false,
          can_reject: false,
          held_points: 50,
        },
      }),
    );
    renderEditPage();
    await priceInput();

    expect(
      screen.getByText(
        "Zarezerwowana przez Ania za 50 pkt — ta rezerwacja rozliczy się po 50 pkt. Nowa cena dotyczy kolejnych osób.",
      ),
    ).toBeInTheDocument();
  });

  it("blocks an invalid price, then saves the PATCH first and PUTs the price after it", async () => {
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(pointsActions());
    renderEditPage();
    const form = await editForm();
    const input = await priceInput();

    fireEvent.change(input, { target: { value: "55" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Cena musi być od 20 do 60 pkt, co 10.");
    expect(within(form).getByRole("button", { name: "Zapisz zmiany" })).toBeDisabled();

    fireEvent.change(within(form).getByLabelText("Stan"), { target: { value: "LIKE_NEW" } });
    await screen.findByText("Dozwolone 30–90 pkt, co 10");
    fireEvent.change(input, { target: { value: "70" } });
    fireEvent.click(within(form).getByRole("button", { name: "Zapisz zmiany" }));

    expect(await screen.findByText("Moje rzeczy")).toBeInTheDocument();
    expect(inventoriesApi.updateInventoryItem).toHaveBeenCalledWith(ITEM_ID, { condition: "LIKE_NEW" });
    expect(listingApi.setItemListingPreference).toHaveBeenCalledWith(ITEM_ID, "POINTS", undefined, 70);
    expect(vi.mocked(inventoriesApi.updateInventoryItem).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(listingApi.setItemListingPreference).mock.invocationCallOrder[0],
    );
  });

  it("sends no PUT when neither the price nor the bounds changed", async () => {
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(pointsActions());
    renderEditPage();
    const form = await editForm();
    await priceInput();
    await waitFor(() => expect(placeSelect()).toHaveValue(KETY.id));
    fireEvent.change(placeSelect(), { target: { value: POZNAN.id } });
    fireEvent.click(within(form).getByRole("button", { name: "Zapisz zmiany" }));

    expect(await screen.findByText("Moje rzeczy")).toBeInTheDocument();
    expect(listingApi.setItemListingPreference).not.toHaveBeenCalled();
  });

  it("shows a 400 on the PUT verbatim and re-reads the stored value", async () => {
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(pointsActions());
    vi.mocked(listingApi.setItemListingPreference).mockRejectedValue(
      new ApiError(400, "Bad Request", { message: "Cena musi być od 30 do 90 pkt, co 10." }),
    );
    renderEditPage();
    const form = await editForm();
    const input = await priceInput();
    await waitFor(() => expect(pointsApi.getOwnedItemPointsValue).toHaveBeenCalledTimes(1));

    fireEvent.change(input, { target: { value: "50" } });
    fireEvent.click(within(form).getByRole("button", { name: "Zapisz zmiany" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Cena musi być od 30 do 90 pkt, co 10.");
    await waitFor(() => expect(pointsApi.getOwnedItemPointsValue).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Moje rzeczy")).not.toBeInTheDocument();
  });
});
