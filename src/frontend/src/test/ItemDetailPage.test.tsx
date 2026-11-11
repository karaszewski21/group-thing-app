import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemEditView } from "../features/items/ItemEditView";
import * as itemsApi from "../api/items";
import * as inventoriesApi from "../api/inventories";
import * as productsApi from "../api/products";
import * as categoriesApi from "../api/categories";
import * as itemActionsApi from "../api/itemActions";
import * as itemReservationsApi from "../api/itemReservations";
import * as reservationsApi from "../api/reservations";
import * as termItemListingsApi from "../api/termItemListings";
import * as locationsApi from "../api/locations";
import type {
  ItemActionsResponse,
  ItemContextOptionResponse,
  ItemLocationResponse,
  ItemPartyReservationResponse,
} from "../api/itemActions";
import { ApiError } from "../api/client";
import { ACCESS_DENIED_MESSAGE } from "../api/problem";
import type { ItemDetailsResponse } from "../api/items";
import type { Category } from "../api/categories";
import type { InventoryBalanceResponse, InventoryItemResponse, MyInventoryItemResponse } from "../api/inventories";
import type { AcceptedSwapProposalResponse, SwapProposalResponse } from "../api/termItemListings";
import type { ProductResponse } from "../api/products";
import { makeItemLocation, makeLocality, makeLocationResponse } from "./fixtures/locations";
import { createQueryWrapper } from "./queryClient";
import { itemRouteElement } from "./itemRoute";
import { getTestLocation, renderWithRoute } from "./renderWithRoute";

vi.mock("../api/items", () => ({
  getItemDetails: vi.fn(),
}));

vi.mock("../api/inventories", () => ({
  updateInventoryItem: vi.fn(),
  getMyInventoryItems: vi.fn(),
  getInventoryItemBalance: vi.fn(),
}));

vi.mock("../api/itemActions", () => ({
  getItemActions: vi.fn(),
}));

vi.mock("../api/itemReservations", () => ({
  takeItem: vi.fn(),
  proposeItemSwap: vi.fn(),
}));

vi.mock("../api/reservations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/reservations")>()),
  confirmTransaction: vi.fn(),
  cancelTransaction: vi.fn(),
}));

vi.mock("../api/termItemListings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/termItemListings")>()),
  acceptSwapProposal: vi.fn(),
  rejectSwapProposal: vi.fn(),
}));

const mockAuth: { token: string | null } = { token: "valid.jwt.token" };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));
/** A stand-in for the panel's AppDataContext: `itemEdit` lives outside the
 * edit page, as it does in the panel. */
const panel = vi.hoisted(() => {
  let state: Record<string, unknown> = {};
  const listeners = new Set<() => void>();
  return {
    reset() {
      state = { ownSlug: "ania", itemEdit: null };
    },
    get: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setters: {
      setItemEdit: (next: unknown) => {
        state = { ...state, itemEdit: next };
        listeners.forEach((listener) => listener());
      },
      refreshItems: async () => {},
    },
  };
});

vi.mock("../features/panel/appDataStore", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useAppData: () => ({ ...useSyncExternalStore(panel.subscribe, panel.get), ...panel.setters }),
  };
});

vi.mock("../api/locations", () => ({
  getMyLocations: vi.fn(),
  createLocation: vi.fn(),
  updateLocation: vi.fn(),
  deleteLocation: vi.fn(),
}));

vi.mock("../api/products", () => ({
  resolveProduct: vi.fn(),
  addProductPhoto: vi.fn(),
  deleteProductPhoto: vi.fn(),
  reorderProductPhotos: vi.fn(),
  updateProductDescription: vi.fn(),
}));

vi.mock("../api/categories", () => ({
  getCategories: vi.fn(),
}));

const conversationHook = vi.hoisted(() => ({ openConversation: vi.fn() }));
vi.mock("../hooks/useOpenConversation", () => ({ useOpenConversation: () => conversationHook }));

const ITEM_ID = "5d7e9f10-2a3b-4c4d-8e5f-6a7b8c9d0e1f";
const PRODUCT_ID = "6e8f0a21-3b4c-4d5e-9f60-7b8c9d0e1f2a";
const REPOINTED_PRODUCT_ID = "b3d45f76-8091-42a3-8eb5-2a3b4c5d6e7f";
const CAT_KIDS = "6f801a21-3b4c-4d5e-8f60-7b8c9d0e1f2a";
const CAT_STROLLERS = "7f901b32-4c5d-4e6f-8a71-8c9d0e1f2a3b";
const CAT_TOYS = "80a12c43-5d6e-4f70-9b82-9d0e1f2a3b4c";
const PHOTO_1 = "91b23d54-6e7f-4081-8c93-0e1f2a3b4c5d";
const PHOTO_2 = "a2c34e65-7f80-4192-9da4-1f2a3b4c5d6e";

/** The owner's live place the edit page's required picker shows. */
const OWN_PLACE = makeLocationResponse();

function details(overrides: Partial<ItemDetailsResponse> = {}): ItemDetailsResponse {
  return {
    id: ITEM_ID,
    product_id: PRODUCT_ID,
    name: "Wózek spacerowy Baby Jogger",
    category_id: CAT_STROLLERS,
    category_name: "Wózki",
    condition: "GOOD",
    description: "Lekki, składany, z daszkiem i koszem.",
    photos: [
      {
        id: PHOTO_1,
        url: "https://img.example/1.webp",
        thumb_url: "https://img.example/1-thumb.webp",
        status: "APPROVED",
        sort_order: 0,
      },
      {
        id: PHOTO_2,
        url: "https://img.example/2.webp",
        thumb_url: "https://img.example/2-thumb.webp",
        status: "APPROVED",
        sort_order: 1,
      },
    ],
    product_photo_url: null,
    is_owner: true,
    deleted_at: null,
    listing_status: "DRAFT",
    location_id: OWN_PLACE.id,
    status: {
      code: "LENT",
      term_occurs_on: null,
      due_date: "2026-10-20T00:00:00",
      counterparty_label: "Anna Kowalska",
      personal_pickup: false,
    },
    ...overrides,
  };
}

const OWNER: ItemActionsResponse["owner"] = {
  party_id: "party-1",
  display_name: "Bartek K.",
  slug: "bartek",
  items_total: 12,
};

const LOCATION: ItemLocationResponse = makeItemLocation({
  locality: makeLocality({ id: "0941370", name: "Nowa Wieś", kind: "VILLAGE" }),
});
const LOCALITY_DETAIL = "gm. Kęty, pow. oświęcimski, małopolskie";
const LOCALITY_MAPS_URL =
  "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent("Nowa Wieś, gmina Kęty, małopolskie, Polska");
const OWN_LOCATION: ItemLocationResponse = { ...LOCATION, formatted_address: "ul. Polna 12, 32-650 Nowa Wieś" };

// 2026-11-07 is a Saturday, 2026-11-11 a Wednesday.
const TERM_CONTEXT: ItemContextOptionResponse = {
  kind: "TERM",
  id: "t-1",
  name: "Wymianka przedszkolna",
  starts_at: "2026-11-07T10:00:00",
  path: "/bartek/group/g-1/term/t-1",
  has_started: false,
  location_name: "Przedszkole nr 12",
  eligible: true,
};

const EVENT_CONTEXT: ItemContextOptionResponse = {
  kind: "EVENT",
  id: "ev-1",
  name: "Jarmark sąsiedzki",
  starts_at: "2026-11-11T16:00:00",
  path: "/bartek/event/ev-1",
  has_started: false,
  location_name: "Park Dreszera",
  eligible: true,
};

const NOT_ELIGIBLE_CONTEXT: ItemContextOptionResponse = {
  ...EVENT_CONTEXT,
  id: "ev-9",
  name: "Kiermasz zimowy",
  eligible: false,
};

function itemActions(overrides: Partial<ItemActionsResponse> = {}): ItemActionsResponse {
  return {
    mode: "GIFT",
    visibility: null,
    available: true,
    reservation: null,
    party_reservation: null,
    owner: OWNER,
    viewer: "OTHER",
    location: null,
    contexts: [],
    personal_pickup_available: false,
    ...overrides,
  };
}

function party(overrides: Partial<ItemPartyReservationResponse> = {}): ItemPartyReservationResponse {
  return {
    role: "RECEIVER",
    reservation_id: "r-1",
    proposal_id: null,
    reservation_type: "GIFT",
    personal_pickup: true,
    can_confirm: false,
    can_cancel: false,
    can_accept: false,
    can_reject: false,
    ...overrides,
  };
}

/** After `vi.resetAllMocks()`: a logged-in viewer, an actions read with no
 * location or contexts, the owner's places and a fresh panel. */
function mockDefaults() {
  mockAuth.token = "valid.jwt.token";
  panel.reset();
  vi.mocked(locationsApi.getMyLocations).mockResolvedValue([OWN_PLACE]);
  vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(itemActions());
}

function category(id: string, name: string, parent_id: string | null, sort_order: number): Category {
  return { id, name, description: null, parent_id, sort_order, product_count: 1, created_at: "", updated_at: "" };
}

const categories: Category[] = [
  category(CAT_KIDS, "Dzieci", null, 0),
  category(CAT_STROLLERS, "Wózki", CAT_KIDS, 0),
  category(CAT_TOYS, "Zabawki", CAT_KIDS, 1),
];

async function renderPage(path: string) {
  return renderWithRoute(await itemRouteElement(path), {
    url: path,
    pattern: "/:slug/product/:id",
    routes: { "/messages/:id": <p>Wątek rozmowy</p> },
    wrapper: createQueryWrapper(),
  });
}

/** The panel's `/items/:id/edit`, opened directly (no in-app history). */
function renderEditPage() {
  return renderWithRoute(<ItemEditView />, {
    url: `/items/${ITEM_ID}/edit`,
    pattern: "/items/:id/edit",
    routes: { "/items": <p>Moje rzeczy</p> },
    wrapper: createQueryWrapper(),
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("ItemDetailPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDefaults();
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details());
    vi.mocked(categoriesApi.getCategories).mockResolvedValue(categories);
  });

  it("view renders fields, gallery and status without an Edytuj link, and no history", async () => {
    await renderPage(`/bartek/product/${ITEM_ID}`);

    expect(await screen.findByRole("heading", { name: "Wózek spacerowy Baby Jogger" })).toBeInTheDocument();
    expect(screen.getByText("Wózki · Stan: Dobry")).toBeInTheDocument();
    expect(screen.getByText("Lekki, składany, z daszkiem i koszem.")).toBeInTheDocument();
    expect(screen.getByAltText("Wózek spacerowy Baby Jogger — zdjęcie 1")).toHaveAttribute(
      "referrerpolicy",
      "no-referrer",
    );
    expect(screen.getByRole("button", { name: "Zdjęcie 2 z 2" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Pożyczona do 20.10.2026")).toBeInTheDocument();
    expect(screen.getByText("U: Anna Kowalska")).toBeInTheDocument();

    expect(screen.queryByText("Historia")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Edytuj/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Edycja rzeczy" })).not.toBeInTheDocument();
    expect(itemsApi.getItemDetails).toHaveBeenCalledWith(ITEM_ID);
  });

  it("owner_noTextModerationBanner_descriptionVisible", async () => {
    await renderPage(`/bartek/product/${ITEM_ID}`);

    expect(await screen.findByText("Lekki, składany, z daszkiem i koszem.")).toBeInTheDocument();
    expect(screen.queryByText(/Nazwa i opis są sprawdzane/)).not.toBeInTheDocument();
    expect(screen.queryByText(/odrzucone przez moderację/)).not.toBeInTheDocument();
    expect(screen.queryByText("W moderacji")).not.toBeInTheDocument();
  });

  it("not found for 404 and 400 (malformed id), error state retries", async () => {
    vi.mocked(itemsApi.getItemDetails).mockRejectedValue(new ApiError(404, "Not Found", null));
    const first = await renderPage(`/bartek/product/${ITEM_ID}`);
    expect(await screen.findByText("Nie znaleziono tej rzeczy.")).toBeInTheDocument();
    first.unmount();

    vi.mocked(itemsApi.getItemDetails).mockRejectedValue(new ApiError(400, "Bad Request", null));
    const second = await renderPage("/bartek/product/not-a-uuid");
    expect(await screen.findByText("Nie znaleziono tej rzeczy.")).toBeInTheDocument();
    second.unmount();

    vi.mocked(itemsApi.getItemDetails).mockRejectedValueOnce(
      new ApiError(500, "Server Error", { message: "Awaria serwera" }),
    );
    await renderPage(`/bartek/product/${ITEM_ID}`);
    expect(await screen.findByText("Nie udało się wczytać rzeczy — spróbuj ponownie")).toBeInTheDocument();
    expect(screen.getByText("Awaria serwera")).toBeInTheDocument();

    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details());
    fireEvent.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
    expect(await screen.findByRole("heading", { name: "Wózek spacerowy Baby Jogger" })).toBeInTheDocument();
  });

  it("deleted item shows the banner and no Edytuj; its edit page refuses to edit", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(
      details({
        deleted_at: "2026-10-14T09:00:00",
        status: {
          code: "DELETED",
          term_occurs_on: null,
          due_date: null,
          counterparty_label: null,
          personal_pickup: false,
        },
      }),
    );
    const { unmount } = await renderPage(`/bartek/product/${ITEM_ID}`);

    const banner = await screen.findByText("Rzecz usunięta");
    expect(banner.closest('[role="status"]')).not.toBeNull();
    expect(screen.getByText("Ta rzecz została usunięta 14.10.2026.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Edytuj/ })).not.toBeInTheDocument();
    unmount();

    renderEditPage();
    expect(await screen.findByText("Tej rzeczy nie możesz edytować.")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Edycja rzeczy" })).not.toBeInTheDocument();
  });

  it("a non-owner sees no Edytuj, and the edit page refuses to edit", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details({ is_owner: false }));
    const { unmount } = await renderPage(`/bartek/product/${ITEM_ID}`);

    expect(await screen.findByRole("heading", { name: "Wózek spacerowy Baby Jogger" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Edytuj/ })).not.toBeInTheDocument();
    unmount();

    renderEditPage();
    expect(await screen.findByText("Tej rzeczy nie możesz edytować.")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Edycja rzeczy" })).not.toBeInTheDocument();
  });

  it("the edit page fills the fields; Zapisz saves condition and description together and goes to /items", async () => {
    vi.mocked(inventoriesApi.updateInventoryItem).mockResolvedValue({} as InventoryItemResponse);
    vi.mocked(productsApi.updateProductDescription).mockResolvedValue({ description: "Nowy opis" });
    renderEditPage();

    const form = await screen.findByRole("form", { name: "Edycja rzeczy" });
    expect(within(form).getByLabelText("Nazwa")).toHaveValue("Wózek spacerowy Baby Jogger");
    expect(within(form).getByLabelText("Nazwa")).toHaveFocus();
    expect(within(form).getByLabelText("Opis")).toHaveValue("Lekki, składany, z daszkiem i koszem.");
    expect(within(form).getByLabelText("Stan")).toHaveValue("GOOD");
    expect(await within(form).findByRole("button", { name: /^Kategoria Dzieci ›\s+Wózki/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zobacz stronę rzeczy →" })).toHaveAttribute(
      "href",
      `/ania/product/${ITEM_ID}`,
    );

    fireEvent.change(within(form).getByLabelText("Stan"), { target: { value: "LIKE_NEW" } });
    fireEvent.change(within(form).getByLabelText("Opis"), { target: { value: "Nowy opis" } });
    fireEvent.click(within(form).getByRole("button", { name: "Zapisz zmiany" }));

    await waitFor(() => expect(productsApi.updateProductDescription).toHaveBeenCalledWith(PRODUCT_ID, "Nowy opis"));
    await waitFor(() =>
      expect(inventoriesApi.updateInventoryItem).toHaveBeenCalledWith(ITEM_ID, { condition: "LIKE_NEW" }),
    );
    expect(productsApi.resolveProduct).not.toHaveBeenCalled();
    expect(await screen.findByText("Moje rzeczy")).toBeInTheDocument();
  });

  it("Anuluj leaves the edit page without saving", async () => {
    renderEditPage();

    const form = await screen.findByRole("form", { name: "Edycja rzeczy" });
    fireEvent.change(within(form).getByLabelText("Nazwa"), { target: { value: "Inna nazwa" } });
    fireEvent.click(within(form).getByRole("button", { name: "Anuluj" }));

    expect(await screen.findByText("Moje rzeczy")).toBeInTheDocument();
    expect(inventoriesApi.updateInventoryItem).not.toHaveBeenCalled();
    expect(productsApi.updateProductDescription).not.toHaveBeenCalled();
  });

  it("a name and category change locks the description, then resolves the product and re-points the item", async () => {
    const resolved = { id: REPOINTED_PRODUCT_ID } as unknown as ProductResponse;
    vi.mocked(productsApi.resolveProduct).mockResolvedValue(resolved);
    vi.mocked(inventoriesApi.updateInventoryItem).mockResolvedValue({} as InventoryItemResponse);
    renderEditPage();

    const form = await screen.findByRole("form", { name: "Edycja rzeczy" });
    fireEvent.change(within(form).getByLabelText("Nazwa"), { target: { value: "Grzechotka" } });
    expect(
      within(form).getByText(
        /Zdjęcia i opis należą do produktu — po zmianie nazwy lub kategorii rzecz pokaże zdjęcia i opis nowego produktu\./,
      ),
    ).toBeInTheDocument();
    expect(within(form).getByLabelText("Opis")).toBeDisabled();
    const picker = await within(form).findByRole("button", { name: /^Kategoria Dzieci ›\s+Wózki/ });
    fireEvent.click(picker);
    fireEvent.click(await screen.findByRole("button", { name: "Zabawki" }));
    expect(await within(form).findByRole("button", { name: /^Kategoria Dzieci ›\s+Zabawki/ })).toBeInTheDocument();

    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(
      details({ product_id: REPOINTED_PRODUCT_ID, name: "Grzechotka", category_id: CAT_TOYS }),
    );
    fireEvent.click(within(form).getByRole("button", { name: "Zapisz zmiany" }));

    await waitFor(() =>
      expect(inventoriesApi.updateInventoryItem).toHaveBeenCalledWith(ITEM_ID, { product_id: resolved.id }),
    );
    expect(productsApi.resolveProduct).toHaveBeenCalledWith({ name: "Grzechotka", category_id: CAT_TOYS });
    expect(productsApi.updateProductDescription).not.toHaveBeenCalled();
    expect(await screen.findByText("Moje rzeczy")).toBeInTheDocument();
  });

  it("a failed details refetch locks photos and the description with a retry", async () => {
    vi.mocked(productsApi.deleteProductPhoto).mockResolvedValue(undefined);
    renderEditPage();

    await screen.findByRole("form", { name: "Edycja rzeczy" });
    vi.mocked(itemsApi.getItemDetails).mockRejectedValue(new ApiError(500, "Server Error", null));
    fireEvent.click(screen.getByRole("button", { name: "Usuń zdjęcie 1" }));

    expect(await screen.findByText(/zdjęcia i opis są chwilowo zablokowane/)).toBeInTheDocument();
    expect(screen.getByLabelText("Opis")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Usuń zdjęcie 1" })).toBeDisabled();
    expect(screen.getByLabelText("Stan")).toBeEnabled();

    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details());
    fireEvent.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
    await waitFor(() => expect(screen.getByLabelText("Opis")).toBeEnabled());
    expect(screen.queryByText(/chwilowo zablokowane/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Usuń zdjęcie 1" })).toBeEnabled();
  });

  it("a 403 on a description save shows ACCESS_DENIED_MESSAGE inline and stays on the edit page", async () => {
    vi.mocked(productsApi.updateProductDescription).mockRejectedValue(
      new ApiError(403, "Forbidden", { message: "Access denied" }),
    );
    renderEditPage();

    const form = await screen.findByRole("form", { name: "Edycja rzeczy" });
    fireEvent.change(within(form).getByLabelText("Opis"), { target: { value: "Inny opis" } });
    fireEvent.click(within(form).getByRole("button", { name: "Zapisz zmiany" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent(ACCESS_DENIED_MESSAGE);
    expect(within(form).getByLabelText("Opis")).toHaveValue("Inny opis");
  });

  it("the edit page photo slider validates files and locks its controls while a move is pending", async () => {
    const pending = deferred<productsApi.ProductPhotoResponse[]>();
    vi.mocked(productsApi.reorderProductPhotos).mockReturnValue(pending.promise);
    renderEditPage();

    await screen.findByRole("form", { name: "Edycja rzeczy" });
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    expect(screen.getByText(/Zdjęcia zmieniasz na górze — zapisują się od razu/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Dodaj zdjęcia"), {
      target: { files: [new File(["x"], "x.gif", { type: "image/gif" })] },
    });
    expect(screen.getByText("Nieobsługiwany plik — dodaj zdjęcie JPG, PNG lub WebP")).toBeInTheDocument();
    expect(productsApi.addProductPhoto).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Przesuń zdjęcie 1 dalej" }));
    await waitFor(() => expect(productsApi.reorderProductPhotos).toHaveBeenCalledWith(PRODUCT_ID, [PHOTO_2, PHOTO_1]));
    expect(screen.getByRole("button", { name: "Usuń zdjęcie 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Przesuń zdjęcie 1 dalej" })).toBeDisabled();
    expect(screen.getByLabelText("Dodaj zdjęcia")).toBeDisabled();

    pending.resolve([]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Usuń zdjęcie 1" })).toBeEnabled());
    expect(itemsApi.getItemDetails).toHaveBeenCalledTimes(2);

    vi.mocked(productsApi.deleteProductPhoto).mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Następne zdjęcie" }));
    fireEvent.click(screen.getByRole("button", { name: "Usuń zdjęcie 2" }));
    await waitFor(() => expect(productsApi.deleteProductPhoto).toHaveBeenCalledWith(PRODUCT_ID, PHOTO_2));
    expect(screen.getByRole("form", { name: "Edycja rzeczy" })).toBeInTheDocument();
  });

  it("PROPOSED_SWAP copy renders", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(
      details({
        status: {
          code: "PROPOSED_SWAP",
          term_occurs_on: null,
          due_date: null,
          counterparty_label: "Ty",
          personal_pickup: false,
        },
      }),
    );
    await renderPage(`/bartek/product/${ITEM_ID}`);

    expect(await screen.findByText("Zaproponowana do zamiany — czeka na decyzję")).toBeInTheDocument();
    expect(screen.getByText("Dla: Ty")).toBeInTheDocument();
  });
});

describe("ItemDetailPage context actions", () => {
  const PERSONAL = /^Odbiorę osobiście$/;
  const CHOOSE = /^Wybieram termin$/;
  const CHAT = "💬 Napisz o przedmiocie";

  const mySwapItem: MyInventoryItemResponse = {
    id: "m1",
    inventory_id: "inv",
    home_inventory_id: null,
    product_id: "pr1",
    product_name: "Blender",
    condition: "GOOD",
    listing_status: "ACTIVE",
    added_at: "2026-10-01T10:00:00",
    created_at: "2026-10-01T10:00:00",
    updated_at: "2026-10-01T10:00:00",
    listing_mode: "SWAP",
    listing_visibility: "PUBLIC",
    location_id: null,
    photos_moderation_pending: false,
    balance_status: "AVAILABLE",
    reservation_id: null,
  };
  const availableBalance: InventoryBalanceResponse = {
    id: "b1",
    item_id: "m1",
    status: "AVAILABLE",
    reserved_at: null,
    lent_at: null,
    returned_at: null,
    due_date: null,
    reservation_id: null,
  };
  const proposal: SwapProposalResponse = {
    id: "s1",
    proposer_party_id: "p2",
    listing_item_id: ITEM_ID,
    offered_item_id: "m1",
    proposer_reservation_id: "r2",
    status: "PROPOSED",
    created_at: "2026-10-01T10:00:00",
    updated_at: "2026-10-01T10:00:00",
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mockDefaults();
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details({ is_owner: false }));
  });

  it("logged in: the intent badge, location block, context list and the three actions in order", async () => {
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(
      itemActions({
        mode: "SWAP",
        location: LOCATION,
        contexts: [TERM_CONTEXT, EVENT_CONTEXT],
        personal_pickup_available: true,
      }),
    );
    conversationHook.openConversation.mockResolvedValue("conv-9");
    await renderPage(`/bartek/product/${ITEM_ID}`);

    expect(await screen.findByText("Chcę się zamienić")).toBeInTheDocument();
    const location = screen.getByRole("region", { name: "Lokalizacja przedmiotu" });
    expect(location).toHaveTextContent(`Nowa Wieś${LOCALITY_DETAIL}`);
    expect(within(location).getByRole("link", { name: "Otwórz w Mapach (nowa karta)" })).toHaveAttribute(
      "href",
      LOCALITY_MAPS_URL,
    );
    expect(location).toHaveTextContent("Odbiór osobisty dostępny.");
    expect(location).not.toHaveTextContent("Widoczne tylko dla Ciebie");
    const list = screen.getByRole("region", { name: "Gdzie jeszcze można odebrać" });
    const select = within(list).getByRole("combobox", { name: "Gdzie jeszcze można odebrać" });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "sob 7 lis, 10:00 · Wymianka przedszkolna",
      "śr 11 lis, 16:00 · Jarmark sąsiedzki (wydarzenie)",
    ]);
    expect(within(list).getByRole("link", { name: /Zobacz termin ›/ })).toHaveAttribute(
      "href",
      "/bartek/group/g-1/term/t-1",
    );
    fireEvent.change(select, { target: { value: "EVENT-ev-1" } });
    expect(within(list).getByRole("link", { name: /Zobacz wydarzenie ›/ })).toHaveAttribute("href", "/bartek/event/ev-1");
    const actionsCard = screen.getByRole("region", { name: "Jak chcesz odebrać?" });
    expect(
      within(actionsCard)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Odbiorę osobiście", "Wybieram termin"]);
    const chatButton = screen.getByRole("button", { name: CHAT });
    expect(actionsCard.compareDocumentPosition(chatButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      chatButton.compareDocumentPosition(screen.getByRole("region", { name: "Właściciel" })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(itemActionsApi.getItemActions).toHaveBeenCalledWith(ITEM_ID);

    fireEvent.click(screen.getByRole("button", { name: CHAT }));
    expect(await screen.findByText("Wątek rozmowy")).toBeInTheDocument();
    expect(conversationHook.openConversation).toHaveBeenCalledWith({ kind: "ITEM", id: ITEM_ID });
  });

  it("without a location or eligible context both reserve actions are aria-disabled with hints and do nothing", async () => {
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(itemActions({ contexts: [NOT_ELIGIBLE_CONTEXT] }));
    await renderPage(`/bartek/product/${ITEM_ID}`);

    const personal = await screen.findByRole("button", { name: PERSONAL });
    expect(personal).toHaveAttribute("aria-disabled", "true");
    expect(personal).toHaveAccessibleDescription(
      "Bartek K. nie ustawił(a) jeszcze miejsca odbioru — napisz na czacie, żeby się umówić.",
    );
    const choose = screen.getByRole("button", { name: CHOOSE });
    expect(choose).toHaveAttribute("aria-disabled", "true");
    expect(choose).toHaveAccessibleDescription(
      "Nie macie wspólnego terminu ani wydarzenia, na które jesteś zapisany(-a).",
    );
    expect(screen.queryByRole("region", { name: "Lokalizacja przedmiotu" })).not.toBeInTheDocument();

    fireEvent.click(personal);
    fireEvent.click(choose);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(itemReservationsApi.takeItem).not.toHaveBeenCalled();
  });

  it("with a location but no personal pickup, Odbiorę osobiście is aria-disabled and described by why", async () => {
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(
      itemActions({ location: LOCATION, personal_pickup_available: false, contexts: [TERM_CONTEXT] }),
    );
    await renderPage(`/bartek/product/${ITEM_ID}`);

    const personal = await screen.findByRole("button", { name: PERSONAL });
    expect(personal).toHaveAttribute("aria-disabled", "true");
    expect(personal).toHaveAccessibleDescription("Odbiór osobisty nie jest dostępny dla tej rzeczy.");
    fireEvent.click(personal);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(itemReservationsApi.takeItem).not.toHaveBeenCalled();
  });

  it.each([
    ["TERM", TERM_CONTEXT, /Rzecz czeka na Ciebie na tym terminie/],
    ["EVENT", EVENT_CONTEXT, /Rzecz czeka na Ciebie na tym wydarzeniu/],
  ] as const)("Wybieram termin reserves a GIFT in a %s context", async (kind, context, reminder) => {
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(
      itemActions({ contexts: [TERM_CONTEXT, NOT_ELIGIBLE_CONTEXT, EVENT_CONTEXT] }),
    );
    vi.mocked(itemReservationsApi.takeItem).mockResolvedValue({
      item_id: ITEM_ID,
      product_name: "Wózek spacerowy Baby Jogger",
      context,
    });
    await renderPage(`/bartek/product/${ITEM_ID}`);

    fireEvent.click(await screen.findByRole("button", { name: CHOOSE }));
    const sheet = await screen.findByRole("dialog", { name: "Wybierz termin odbioru" });
    expect(sheet).toHaveTextContent("Pokazujemy terminy i wydarzenia, w których bierzesz udział razem z Bartek K.");
    expect(within(sheet).getAllByRole("radio")).toHaveLength(2);
    fireEvent.click(within(sheet).getByRole("radio", { name: new RegExp(context.name) }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Rezerwuję na ten termin" }));

    expect(await screen.findByRole("dialog", { name: /Odbierz „Wózek spacerowy Baby Jogger”/ })).toBeInTheDocument();
    expect(screen.getByText(reminder)).toBeInTheDocument();
    expect(itemReservationsApi.takeItem).toHaveBeenCalledWith(ITEM_ID, {
      context: { kind, id: context.id },
      reservation_type: "GIFT",
    });
  });

  it("SWAP: Wybieram termin continues to the swap picker and proposes in the chosen context", async () => {
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(
      itemActions({ mode: "SWAP", contexts: [EVENT_CONTEXT] }),
    );
    vi.mocked(inventoriesApi.getMyInventoryItems).mockResolvedValue([mySwapItem]);
    vi.mocked(inventoriesApi.getInventoryItemBalance).mockResolvedValue(availableBalance);
    vi.mocked(itemReservationsApi.proposeItemSwap).mockResolvedValue(proposal);
    await renderPage(`/bartek/product/${ITEM_ID}`);

    fireEvent.click(await screen.findByRole("button", { name: CHOOSE }));
    const sheet = await screen.findByRole("dialog", { name: "Wybierz termin odbioru" });
    expect(sheet).toHaveTextContent(
      "Bartek K. chce się zamienić — w następnym kroku wybierzesz rzecz, którą zaproponujesz.",
    );
    fireEvent.click(within(sheet).getByRole("button", { name: "Dalej: wybierz rzecz na zamianę" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Co proponujesz w zamian za „Wózek spacerowy Baby Jogger”?",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Zaproponuj zamianę" }));

    await waitFor(() =>
      expect(itemReservationsApi.proposeItemSwap).toHaveBeenCalledWith(ITEM_ID, {
        context: { kind: "EVENT", id: "ev-1" },
        offered_item_id: "m1",
      }),
    );
    expect(itemReservationsApi.takeItem).not.toHaveBeenCalled();
  });

  it("personal GIFT: the sheet reserves with PERSONAL without opening the chat", async () => {
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(
      itemActions({ location: LOCATION, personal_pickup_available: true }),
    );
    vi.mocked(itemReservationsApi.takeItem).mockResolvedValue({
      item_id: ITEM_ID,
      product_name: "Wózek spacerowy Baby Jogger",
      context: null,
    });
    await renderPage(`/bartek/product/${ITEM_ID}`);

    fireEvent.click(await screen.findByRole("button", { name: PERSONAL }));
    const sheet = await screen.findByRole("dialog", { name: "Odbiór osobisty" });
    expect(sheet).toHaveTextContent("📍 Nowa Wieś");
    expect(sheet).toHaveTextContent(
      "Dokładny adres i godzinę ustalicie z Bartek K. na czacie — nie udostępniamy adresu w aplikacji.",
    );
    expect(sheet).toHaveTextContent(
      "Zarezerwujemy dla Ciebie Wózek spacerowy Baby Jogger. Gdy odbierzesz rzecz, potwierdź przekazanie na tej stronie.",
    );
    expect(within(sheet).getByRole("button", { name: "Anuluj" })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Rezerwuję" }));

    expect(await screen.findByText("Zarezerwowano!")).toBeInTheDocument();
    expect(itemReservationsApi.takeItem).toHaveBeenCalledWith(ITEM_ID, {
      context: { kind: "PERSONAL" },
      reservation_type: "GIFT",
    });
    expect(screen.queryByRole("dialog", { name: "Odbiór osobisty" })).not.toBeInTheDocument();
    expect(conversationHook.openConversation).not.toHaveBeenCalled();
  });

  it("personal: \"Piszę do\" opens the ITEM chat without reserving", async () => {
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(
      itemActions({ location: LOCATION, personal_pickup_available: true }),
    );
    conversationHook.openConversation.mockResolvedValue("conv-9");
    await renderPage(`/bartek/product/${ITEM_ID}`);

    fireEvent.click(await screen.findByRole("button", { name: PERSONAL }));
    const sheet = await screen.findByRole("dialog", { name: "Odbiór osobisty" });
    fireEvent.click(within(sheet).getByRole("button", { name: "💬 Piszę do Bartek K." }));

    expect(await screen.findByText("Wątek rozmowy")).toBeInTheDocument();
    expect(conversationHook.openConversation).toHaveBeenCalledWith({ kind: "ITEM", id: ITEM_ID });
    expect(itemReservationsApi.takeItem).not.toHaveBeenCalled();
  });

  it("personal: a \"Piszę do\" chat failure closes the sheet and shows the error", async () => {
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(
      itemActions({ location: LOCATION, personal_pickup_available: true }),
    );
    conversationHook.openConversation.mockRejectedValue(new Error("Za dużo nowych rozmów — spróbuj później"));
    await renderPage(`/bartek/product/${ITEM_ID}`);

    fireEvent.click(await screen.findByRole("button", { name: PERSONAL }));
    const sheet = await screen.findByRole("dialog", { name: "Odbiór osobisty" });
    fireEvent.click(within(sheet).getByRole("button", { name: /^💬 Piszę do/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Za dużo nowych rozmów — spróbuj później");
    expect(screen.queryByRole("dialog", { name: "Odbiór osobisty" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: CHAT })).toBeEnabled();
    expect(itemReservationsApi.takeItem).not.toHaveBeenCalled();
  });

  it("personal SWAP: the sheet continues to the swap picker and proposes with PERSONAL", async () => {
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(
      itemActions({ mode: "SWAP", location: LOCATION, personal_pickup_available: true }),
    );
    vi.mocked(inventoriesApi.getMyInventoryItems).mockResolvedValue([mySwapItem]);
    vi.mocked(inventoriesApi.getInventoryItemBalance).mockResolvedValue(availableBalance);
    vi.mocked(itemReservationsApi.proposeItemSwap).mockResolvedValue(proposal);
    await renderPage(`/bartek/product/${ITEM_ID}`);

    fireEvent.click(await screen.findByRole("button", { name: PERSONAL }));
    const sheet = await screen.findByRole("dialog", { name: "Odbiór osobisty" });
    expect(sheet).toHaveTextContent(
      "Zaproponujesz zamianę za Wózek spacerowy Baby Jogger. Gdy Bartek K. ją przyjmie i się wymienicie, potwierdźcie to na tej stronie.",
    );
    fireEvent.click(within(sheet).getByRole("button", { name: "Proponuję zamianę" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Co proponujesz w zamian za „Wózek spacerowy Baby Jogger”?",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Zaproponuj zamianę" }));

    await waitFor(() => expect(itemReservationsApi.proposeItemSwap).toHaveBeenCalledWith(ITEM_ID, {
      context: { kind: "PERSONAL" },
      offered_item_id: "m1",
    }));
    expect(conversationHook.openConversation).not.toHaveBeenCalled();
  });

  it("anonymous: the locality card, the context list and the reserve/chat buttons, each opening the login sheet", async () => {
    mockAuth.token = null;
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(
      itemActions({ viewer: "ANONYMOUS", location: LOCATION, contexts: [TERM_CONTEXT] }),
    );
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(
      details({
        is_owner: false,
        status: { code: "AVAILABLE", term_occurs_on: null, due_date: null, counterparty_label: null, personal_pickup: false },
      }),
    );
    await renderPage(`/bartek/product/${ITEM_ID}`);

    const card = await screen.findByRole("region", { name: "Jak chcesz odebrać?" });
    expect(within(card).queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Status: Dostępna");
    expect(screen.getByText("Chcę oddać").compareDocumentPosition(screen.getByRole("status")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText("Dostępna")).toHaveLength(1);
    expect(within(card).queryByRole("button", { name: "Zaloguj się" })).not.toBeInTheDocument();
    for (const button of [
      within(card).getByRole("button", { name: PERSONAL }),
      within(card).getByRole("button", { name: /^Wybieram termin$/ }),
      screen.getByRole("button", { name: /Napisz o przedmiocie/ }),
    ]) {
      fireEvent.click(button);
      const sheet = screen.getByRole("dialog", { name: "Potrzebne konto" });
      expect(within(sheet).getByRole("tab", { name: "Zaloguj się" })).toHaveAttribute("aria-selected", "true");
      fireEvent.click(within(sheet).getByRole("button", { name: "Zamknij" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    }
    expect(itemReservationsApi.takeItem).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Gdzie jeszcze można odebrać" })).toHaveTextContent(
      "Wymianka przedszkolna",
    );
    const location = screen.getByRole("region", { name: "Lokalizacja przedmiotu" });
    expect(location).toHaveTextContent(`Nowa Wieś${LOCALITY_DETAIL}`);
    expect(within(location).getByRole("link", { name: "Otwórz w Mapach (nowa karta)" })).toHaveAttribute(
      "href",
      LOCALITY_MAPS_URL,
    );
    expect(within(location).queryByRole("link", { name: "Zmień lokalizację" })).not.toBeInTheDocument();
  });

  it("with a Maps key, the location card maps the locality for others and the address for the owner", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "test-key");
    try {
      vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(itemActions({ location: OWN_LOCATION }));
      const { unmount } = await renderPage(`/bartek/product/${ITEM_ID}`);
      const othersMap = new URL((await screen.findByTitle("Mapa: Nowa Wieś")).getAttribute("src")!);
      expect(othersMap.pathname).toBe("/maps/embed/v1/place");
      expect(othersMap.searchParams.get("q")).not.toContain("Polna");
      unmount();

      vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details({ is_owner: true }));
      vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(
        itemActions({ viewer: "OWN", location: OWN_LOCATION }),
      );
      await renderPage(`/bartek/product/${ITEM_ID}`);
      const ownMap = new URL((await screen.findByTitle("Mapa: Nowa Wieś")).getAttribute("src")!);
      expect(ownMap.searchParams.get("q")).toMatch(/^ul\. Polna 12, 32-650 Nowa Wieś, Nowa Wieś/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("own: the locality card plus the owner-only address, no change link, reserve or chat", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details({ is_owner: true }));
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(
      itemActions({ viewer: "OWN", location: OWN_LOCATION, contexts: [TERM_CONTEXT] }),
    );
    await renderPage(`/bartek/product/${ITEM_ID}`);

    const location = await screen.findByRole("region", { name: "Lokalizacja przedmiotu" });
    expect(location).toHaveTextContent(`Nowa Wieś${LOCALITY_DETAIL}`);
    expect(within(location).getByRole("link", { name: "Otwórz w Mapach (nowa karta)" })).toHaveAttribute(
      "href",
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("ul. Polna 12, 32-650 Nowa Wieś")}`,
    );
    expect(location).toHaveTextContent("Widoczne tylko dla Ciebieul. Polna 12, 32-650 Nowa Wieś");
    expect(within(location).queryByRole("link", { name: "Zmień lokalizację" })).not.toBeInTheDocument();
    expect(location).not.toHaveTextContent("Odbiór osobisty niedostępny");
    expect(screen.queryByRole("region", { name: "Rezerwacja" })).not.toBeInTheDocument();
    expect(screen.queryByText(/To Twoja rzecz/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: PERSONAL })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Napisz/ })).not.toBeInTheDocument();
  });

  it.each<[string, ItemLocationResponse | null, string]>([
    [
      "a deleted place",
      { ...OWN_LOCATION, deleted_at: "2026-11-01T09:00:00" },
      `📍Nowa Wieś (usunięte)${LOCALITY_DETAIL}`,
    ],
    ["no place", null, ""],
  ])(
    "own with %s: no Maps link or address, personal pickup off until a place is set",
    async (_name, place, heading) => {
      vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details({ is_owner: true }));
      vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(itemActions({ viewer: "OWN", location: place }));
      await renderPage(`/bartek/product/${ITEM_ID}`);

      const location = await screen.findByRole("region", { name: "Lokalizacja przedmiotu" });
      expect(location).toHaveTextContent(
        `Lokalizacja przedmiotu${heading}Odbiór osobisty niedostępny — ustaw lokalizację w edycji rzeczy.`,
      );
      expect(within(location).queryByRole("link", { name: "Otwórz w Mapach (nowa karta)" })).not.toBeInTheDocument();
      expect(location).not.toHaveTextContent("Widoczne tylko dla Ciebie");
      expect(within(location).queryByRole("link")).not.toBeInTheDocument();
    },
  );

  it("own unlisted item: the U Ciebie status, no Dostępna and no owner note", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(
      details({
        is_owner: true,
        status: {
          code: "AVAILABLE",
          term_occurs_on: null,
          due_date: null,
          counterparty_label: null,
          personal_pickup: false,
        },
      }),
    );
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(itemActions({ viewer: "OWN", mode: null }));
    await renderPage(`/bartek/product/${ITEM_ID}`);

    const status = await screen.findByRole("status");
    expect(screen.queryByText(/nie jest wystawiona/)).not.toBeInTheDocument();
    expect(status).toHaveTextContent("U Ciebie");
    expect(status).not.toHaveTextContent("Dostępna");
  });

  it("own PRIVATE item: the 🔒 Prywatny badge and no owner note", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details({ is_owner: true }));
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(
      itemActions({ viewer: "OWN", mode: "SWAP", visibility: "PRIVATE" }),
    );
    await renderPage(`/bartek/product/${ITEM_ID}`);

    expect(await screen.findByText("🔒 Prywatny")).toBeInTheDocument();
    expect(screen.queryByText(/Prywatna — widzą ją/)).not.toBeInTheDocument();
  });

  it("own PUBLIC item: no private badge", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details({ is_owner: true }));
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(
      itemActions({ viewer: "OWN", mode: "SWAP", visibility: "PUBLIC" }),
    );
    await renderPage(`/bartek/product/${ITEM_ID}`);

    expect(await screen.findByRole("heading", { name: "Wózek spacerowy Baby Jogger" })).toBeInTheDocument();
    expect(screen.queryByText("🔒 Prywatny")).not.toBeInTheDocument();
  });

  it("party: confirm and cancel call the transaction APIs; an already-resolved 409 shows its message and refetches", async () => {
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(
      itemActions({
        available: false,
        location: LOCATION,
        party_reservation: party({ can_confirm: true, can_cancel: true }),
      }),
    );
    vi.mocked(reservationsApi.confirmTransaction).mockRejectedValue(
      new ApiError(409, "Conflict", { reservation_id: "r-1", status: "ALREADY_RESOLVED", already_resolved: true }),
    );
    vi.mocked(reservationsApi.cancelTransaction).mockResolvedValue({
      reservation_id: "r-1",
      status: "CANCELLED",
      already_resolved: false,
    });
    await renderPage(`/bartek/product/${ITEM_ID}`);

    const confirm = await screen.findByRole("button", { name: "Potwierdzam przekazanie" });
    const calls = vi.mocked(itemActionsApi.getItemActions).mock.calls.length;
    fireEvent.click(confirm);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Transakcja została już rozstrzygnięta przez drugą stronę.",
    );
    expect(reservationsApi.confirmTransaction).toHaveBeenCalledWith("r-1");
    await waitFor(() => expect(vi.mocked(itemActionsApi.getItemActions).mock.calls.length).toBeGreaterThan(calls));

    fireEvent.click(screen.getByRole("button", { name: "Anuluj rezerwację" }));
    const ask = await screen.findByRole("alertdialog", { name: "Anulować rezerwację?" });
    expect(reservationsApi.cancelTransaction).not.toHaveBeenCalled();
    fireEvent.click(within(ask).getByRole("button", { name: "Tak, anuluj" }));
    await waitFor(() => expect(reservationsApi.cancelTransaction).toHaveBeenCalledWith("r-1"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "💬 Napisz o przedmiocie" })).toBeEnabled();
  });

  it("party: a failed cancel keeps the dialog open with the error inline; closing it shows the error on the card", async () => {
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(
      itemActions({ available: false, location: LOCATION, party_reservation: party({ can_cancel: true }) }),
    );
    vi.mocked(reservationsApi.cancelTransaction).mockRejectedValue(
      new ApiError(409, "Conflict", {
        type: "about:blank",
        title: "Conflict",
        status: 409,
        detail: "Termin już minął",
      }),
    );
    await renderPage(`/bartek/product/${ITEM_ID}`);

    fireEvent.click(await screen.findByRole("button", { name: "Anuluj rezerwację" }));
    const ask = await screen.findByRole("alertdialog", { name: "Anulować rezerwację?" });
    fireEvent.click(within(ask).getByRole("button", { name: "Tak, anuluj" }));

    expect(await within(ask).findByRole("alert")).toHaveTextContent("Termin już minął");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alertdialog", { name: "Anulować rezerwację?" })).toBeInTheDocument();

    fireEvent.click(within(ask).getByRole("button", { name: "Anuluj" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Termin już minął");
  });

  it("party: the owner accepts or rejects a pending swap proposal", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details({ is_owner: true }));
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(
      itemActions({
        viewer: "OWN",
        party_reservation: party({
          role: "GIVER",
          reservation_id: null,
          proposal_id: "s1",
          reservation_type: "SWAP",
          can_accept: true,
          can_reject: true,
        }),
      }),
    );
    const accepted: AcceptedSwapProposalResponse = {
      ...proposal,
      status: "ACCEPTED",
      term_id: null,
      term_occurs_on: null,
      group_id: null,
      group_name: null,
    };
    vi.mocked(termItemListingsApi.acceptSwapProposal).mockResolvedValue(accepted);
    vi.mocked(termItemListingsApi.rejectSwapProposal).mockResolvedValue({ ...proposal, status: "REJECTED" });
    await renderPage(`/bartek/product/${ITEM_ID}`);

    fireEvent.click(await screen.findByRole("button", { name: "Przyjmij zamianę" }));
    expect(
      await screen.findByText("Zamiana przyjęta — odbiór osobisty, ustalcie szczegóły na czacie."),
    ).toBeInTheDocument();
    expect(termItemListingsApi.acceptSwapProposal).toHaveBeenCalledWith("s1");

    fireEvent.click(screen.getByRole("button", { name: "Odrzuć" }));
    const ask = await screen.findByRole("alertdialog", { name: "Odrzucić propozycję zamiany?" });
    fireEvent.click(within(ask).getByRole("button", { name: "Anuluj" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(termItemListingsApi.rejectSwapProposal).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Odrzuć" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog", { name: "Odrzucić propozycję zamiany?" })).getByRole("button", {
        name: "Tak, odrzuć",
      }),
    );
    await waitFor(() => expect(termItemListingsApi.rejectSwapProposal).toHaveBeenCalledWith("s1"));
  });

  it.each([
    [
      "the GIFT giver waits for the receiver",
      party({ role: "GIVER", can_cancel: true }),
      "Przekazanie potwierdza Anna Kowalska, gdy odbierze rzecz.",
    ],
    [
      "the proposer waits for the owner",
      party({ reservation_id: "r-2", proposal_id: "s1", reservation_type: "SWAP" }),
      "Czekasz na odpowiedź Bartek K. Możesz napisać na czacie.",
    ],
    ["a term reservation before its end", party({ personal_pickup: false }), "Potwierdzicie po terminie."],
  ])("party hint: %s", async (_name, partyReservation, hint) => {
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(
      itemActions({ available: false, party_reservation: partyReservation }),
    );
    await renderPage(`/bartek/product/${ITEM_ID}`);

    expect(await screen.findByText(hint)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Potwierdzam przekazanie" })).not.toBeInTheDocument();
  });

  const PERSONAL_RESERVED: ItemDetailsResponse["status"] = {
    code: "RESERVED",
    term_occurs_on: null,
    due_date: null,
    counterparty_label: "Anna",
    personal_pickup: true,
  };

  it("non-party reserved: header badge, status note, aria-disabled actions with the hint, chat enabled", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details({ is_owner: false, status: PERSONAL_RESERVED }));
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(
      itemActions({
        mode: "SWAP",
        available: false,
        location: LOCATION,
        personal_pickup_available: true,
        contexts: [TERM_CONTEXT],
        reservation: { by_name: "Anna", by_me: false },
      }),
    );
    conversationHook.openConversation.mockResolvedValue("conv-9");
    await renderPage(`/bartek/product/${ITEM_ID}`);

    const badge = await screen.findByText("Zarezerwowana · przez Anna");
    expect(badge).toHaveClass("bg-teal-soft");
    expect(screen.getByText("Chcę się zamienić")).toBeInTheDocument();
    const status = screen.getByRole("region", { name: "Aktualny status" });
    expect(status).toHaveTextContent("Ta rzecz jest zarezerwowana.");
    expect(status).not.toHaveTextContent("ustalacie");
    const hint = "Ktoś już zarezerwował tę rzecz. Jeśli rezerwacja zostanie anulowana, znów będzie dostępna.";
    const personal = screen.getByRole("button", { name: PERSONAL });
    const choose = screen.getByRole("button", { name: CHOOSE });
    for (const action of [personal, choose]) {
      expect(action).toHaveAttribute("aria-disabled", "true");
      expect(action).toHaveAccessibleDescription(hint);
      fireEvent.click(action);
    }
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(itemReservationsApi.takeItem).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Potwierdzam przekazanie" })).not.toBeInTheDocument();

    const chat = screen.getByRole("button", { name: CHAT });
    expect(chat).toBeEnabled();
    expect(chat).not.toHaveAttribute("aria-disabled");
    fireEvent.click(chat);
    expect(await screen.findByText("Wątek rozmowy")).toBeInTheDocument();
  });

  it("a pending proposal on an AVAILABLE balance suppresses Dostępna", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(
      details({
        is_owner: false,
        status: {
          code: "AVAILABLE",
          term_occurs_on: null,
          due_date: null,
          counterparty_label: null,
          personal_pickup: false,
        },
      }),
    );
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(
      itemActions({ mode: "SWAP", available: false, reservation: { by_name: "Tomek", by_me: false } }),
    );
    await renderPage(`/bartek/product/${ITEM_ID}`);

    expect(await screen.findByText("Zarezerwowana · przez Tomek")).toBeInTheDocument();
    const status = screen.getByRole("region", { name: "Aktualny status" });
    expect(status).not.toHaveTextContent("Dostępna");
    expect(status).toHaveTextContent("Ta rzecz jest zarezerwowana.");
  });

  it("party of a personal reservation: the badge reads przez Ciebie and the status names both parties", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(
      details({ is_owner: false, status: { ...PERSONAL_RESERVED, counterparty_label: "Ty" } }),
    );
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(
      itemActions({ available: false, party_reservation: party(), reservation: { by_name: "Anna", by_me: true } }),
    );
    await renderPage(`/bartek/product/${ITEM_ID}`);

    expect(await screen.findByText("Zarezerwowana · przez Ciebie")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Aktualny status" })).toHaveTextContent(
      "Odbiór osobisty — szczegóły ustalają Bartek K. i Anna na czacie.",
    );
    expect(screen.queryByRole("button", { name: PERSONAL })).not.toBeInTheDocument();
  });

  it("an actions failure shows a retry in the card while the rest of the page renders", async () => {
    vi.mocked(itemActionsApi.getItemActions).mockRejectedValueOnce(new ApiError(500, "Server Error", null));
    await renderPage(`/bartek/product/${ITEM_ID}`);

    expect(await screen.findByText("Nie udało się wczytać akcji")).toBeInTheDocument();
    expect(screen.getByText("Lekki, składany, z daszkiem i koszem.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
    expect(await screen.findByRole("button", { name: CHAT })).toBeInTheDocument();
  });
});

describe("ItemDetailPage fallbacks", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDefaults();
    vi.mocked(categoriesApi.getCategories).mockResolvedValue(categories);
  });

  it("gallery shows the catalog product_photo_url when the product has no photos", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(
      details({ photos: [], product_photo_url: "https://img.example/catalog.jpg" }),
    );
    await renderPage(`/bartek/product/${ITEM_ID}`);

    const image = await screen.findByAltText("Wózek spacerowy Baby Jogger — zdjęcie 1");
    expect(image).toHaveAttribute("src", "https://img.example/catalog.jpg");
    expect(screen.queryByRole("button", { name: /^Zdjęcie \d z/ })).not.toBeInTheDocument();
  });

  it("Wróć on a directly opened page falls back to the owner's page", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details());
    renderWithRoute(await itemRouteElement(`/bartek/product/${ITEM_ID}`), {
      url: `/bartek/product/${ITEM_ID}`,
      pattern: "/:slug/product/:id",
      routes: { "/:slug": <p>Strona właściciela</p> },
      wrapper: createQueryWrapper(),
    });

    await screen.findByRole("heading", { name: "Wózek spacerowy Baby Jogger" });
    fireEvent.click(screen.getByRole("button", { name: /Wróć/ }));
    expect(await screen.findByText("Strona właściciela")).toBeInTheDocument();
    expect(getTestLocation().pathname).toBe("/bartek");
  });

  it.each([
    ["the party id of an Organization owner", "party-1"],
    ["a stale slug", "stary-slug"],
  ])("a prefix that is %s is replaced by the owner's slug, keeping the query", async (_, prefix) => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details());
    // Next re-renders the page with the new params; the static test element needs the target route.
    renderWithRoute(await itemRouteElement(`/${prefix}/product/${ITEM_ID}`), {
      url: `/${prefix}/product/${ITEM_ID}?x=1`,
      pattern: `/${prefix}/product/:id`,
      routes: { "/bartek/product/:id": await itemRouteElement(`/bartek/product/${ITEM_ID}`) },
      wrapper: createQueryWrapper(),
    });

    await screen.findByRole("heading", { name: "Wózek spacerowy Baby Jogger" });
    expect(getTestLocation().pathname).toBe(`/bartek/product/${ITEM_ID}`);
    expect(getTestLocation().search).toBe("?x=1");
  });

  it("an owner without an Organization keeps the party id prefix", async () => {
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(itemActions({ owner: { ...OWNER, slug: null } }));
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details());
    await renderPage(`/party-1/product/${ITEM_ID}`);

    await screen.findByRole("heading", { name: "Wózek spacerowy Baby Jogger" });
    expect(getTestLocation().pathname).toBe(`/party-1/product/${ITEM_ID}`);
  });

  it("a missing category renders a fallback instead of null", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details({ category_name: null }));
    await renderPage(`/bartek/product/${ITEM_ID}`);

    expect(await screen.findByText("Bez kategorii · Stan: Dobry")).toBeInTheDocument();
    expect(screen.queryByText(/null/)).not.toBeInTheDocument();
  });

});

describe("ItemDetailPage reservation party view", () => {
  const TERM_ID = "c4e56a87-9102-43b4-9fc5-3a4b5c6d7e8f";
  const GROUP_ID = "d5f67b98-a213-44c5-8ad6-4b5c6d7e8f90";
  const partyStatus = (code: "RESERVED" | "IN_TRANSIT") => ({
    code,
    term_occurs_on: "2026-10-14T16:30:00",
    due_date: null,
    counterparty_label: "Anna K.",
    term_id: TERM_ID,
    group_id: GROUP_ID,
    group_name: "Muzyczne Maluchy",
    personal_pickup: false,
  });

  beforeEach(() => {
    vi.resetAllMocks();
    mockDefaults();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 13, 12, 0));
    vi.mocked(categoriesApi.getCategories).mockResolvedValue(categories);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function openCalendarMenu() {
    fireEvent.click(await screen.findByRole("button", { name: /Dodaj do kalendarza/ }));
    const google = screen.getByRole("menuitem", { name: /Kalendarz Google/ });
    return new URL(google.getAttribute("href") ?? "");
  }

  it("party RESERVED shows hour and group, with the calendar trigger outside the status line", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details({ status: partyStatus("RESERVED") }));
    await renderPage(`/bartek/product/${ITEM_ID}`);

    const line = await screen.findByText("Zarezerwowana — odbiór w śr 14.10 o 16:30 · Muzyczne Maluchy");
    expect(line).toHaveAttribute("role", "status");
    expect(screen.getByText("Dla: Anna K.")).toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: /Dodaj do kalendarza/ });
    expect(line).not.toContainElement(trigger);
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  });

  it("owner gets a Przekazanie title with the Term link in the details", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details({ is_owner: true, status: partyStatus("RESERVED") }));
    await renderPage(`/bartek/product/${ITEM_ID}`);

    const url = await openCalendarMenu();
    expect(url.searchParams.get("text")).toBe("Przekazanie: Wózek spacerowy Baby Jogger");
    expect(url.searchParams.get("details")).toContain(
      `${window.location.origin}/krag/group/${GROUP_ID}/term/${TERM_ID}`,
    );
  });

  it("non-owner party in transit gets an Odbiór title and the W drodze line", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(
      details({ is_owner: false, status: partyStatus("IN_TRANSIT") }),
    );
    await renderPage(`/bartek/product/${ITEM_ID}`);

    expect(await screen.findByText("W drodze — odbiór w śr 14.10 o 16:30 · Muzyczne Maluchy")).toBeInTheDocument();
    const url = await openCalendarMenu();
    expect(url.searchParams.get("text")).toBe("Odbiór: Wózek spacerowy Baby Jogger");
  });

  it("party view hides the calendar trigger once the Term has passed but keeps the dated line", async () => {
    vi.setSystemTime(new Date(2026, 9, 14, 17, 0));
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details({ status: partyStatus("RESERVED") }));
    await renderPage(`/bartek/product/${ITEM_ID}`);

    expect(await screen.findByText("Zarezerwowana — odbiór w śr 14.10 o 16:30 · Muzyczne Maluchy")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Dodaj do kalendarza/ })).not.toBeInTheDocument();
  });

  it("non-party viewer keeps the DD.MM text and gets no calendar trigger", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(
      details({
        is_owner: false,
        status: { ...partyStatus("RESERVED"), term_id: null, group_id: null, group_name: null },
      }),
    );
    await renderPage(`/bartek/product/${ITEM_ID}`);

    expect(await screen.findByText("Zarezerwowana — odbiór na terminie 14.10")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Dodaj do kalendarza/ })).not.toBeInTheDocument();
  });
});

describe("Item edit page status chip and photo hints", () => {
  function withSecondPhoto(status: productsApi.ModerationStatus): ItemDetailsResponse {
    const base = details();
    return details({ photos: [base.photos[0], { ...base.photos[1], status }] });
  }

  beforeEach(() => {
    vi.resetAllMocks();
    mockDefaults();
    vi.mocked(categoriesApi.getCategories).mockResolvedValue(categories);
  });

  it.each([
    ["DRAFT", "Wersja robocza"],
    ["ACTIVE", "Aktywna"],
  ] as const)("the edit page shows the %s status chip next to its heading", async (listing_status, label) => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details({ listing_status }));
    renderEditPage();

    const heading = await screen.findByRole("heading", { name: "Edycja rzeczy" });
    expect(heading.parentElement).toHaveTextContent(label);
    expect(screen.queryByText(label === "Aktywna" ? "Wersja robocza" : "Aktywna")).not.toBeInTheDocument();
  });

  it.each(["PENDING", "NEEDS_REVIEW"] as const)(
    "the edit page shows no moderation notice when a photo is %s",
    async (status) => {
      vi.mocked(itemsApi.getItemDetails).mockResolvedValue(withSecondPhoto(status));
      renderEditPage();

      await screen.findByRole("heading", { name: "Edycja rzeczy" });
      expect(screen.queryByText(/Rzecz zdjęta z terminów/)).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Moje rzeczy →" })).not.toBeInTheDocument();
    },
  );

  it("gallery helper text no longer claims a new photo withdraws the item", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details());
    renderEditPage();

    expect(
      await screen.findByText(/Są wspólne dla wszystkich rzeczy tego produktu, a inni zobaczą je po sprawdzeniu\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Nowe zdjęcie zdejmuje/)).not.toBeInTheDocument();
  });
});

describe("ItemDetailPage PRIVATE item with an open reservation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDefaults();
  });

  it("own: the 🔒 Prywatny badge sits beside the giver's cancel action and hint", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details({ is_owner: true }));
    vi.mocked(itemActionsApi.getItemActions).mockResolvedValue(
      itemActions({
        viewer: "OWN",
        visibility: "PRIVATE",
        available: false,
        reservation: { by_name: "Anna Kowalska", by_me: false },
        party_reservation: party({ role: "GIVER", can_cancel: true }),
      }),
    );
    vi.mocked(reservationsApi.cancelTransaction).mockResolvedValue({
      reservation_id: "r-1",
      status: "CANCELLED",
      already_resolved: false,
    });
    await renderPage(`/bartek/product/${ITEM_ID}`);

    expect(await screen.findByText("🔒 Prywatny")).toBeInTheDocument();
    expect(screen.getByText("Przekazanie potwierdza Anna Kowalska, gdy odbierze rzecz.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Potwierdzam przekazanie" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Anuluj rezerwację" }));
    fireEvent.click(await screen.findByRole("button", { name: "Tak, anuluj" }));
    await waitFor(() => expect(reservationsApi.cancelTransaction).toHaveBeenCalledWith("r-1"));
  });
});
