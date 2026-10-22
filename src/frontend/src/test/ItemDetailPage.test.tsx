import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemDetailPage } from "../pages/product/ItemDetailPage";
import { ItemEditPage } from "../pages/product/ItemEditPage";
import * as itemsApi from "../api/items";
import * as inventoriesApi from "../api/inventories";
import * as productsApi from "../api/products";
import * as categoriesApi from "../api/categories";
import { ApiError } from "../api/client";
import { ACCESS_DENIED_MESSAGE } from "../api/problem";
import type { ItemDetailsResponse, ItemHistoryEntryResponse } from "../api/items";
import type { Category } from "../api/categories";
import type { InventoryItemResponse } from "../api/inventories";
import type { ProductResponse } from "../api/products";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/items", () => ({
  getItemDetails: vi.fn(),
  getItemHistory: vi.fn(),
}));

vi.mock("../api/inventories", () => ({
  updateInventoryItem: vi.fn(),
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
const CAT_STROLLERS = "7f901b32-4c5d-4e6f-8a71-8c9d0e1f2a3b";
const CAT_TOYS = "80a12c43-5d6e-4f70-9b82-9d0e1f2a3b4c";
const PHOTO_1 = "91b23d54-6e7f-4081-8c93-0e1f2a3b4c5d";
const PHOTO_2 = "a2c34e65-7f80-4192-9da4-1f2a3b4c5d6e";

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
      { id: PHOTO_1, url: "https://img.example/1.webp", thumb_url: "https://img.example/1-thumb.webp", status: "APPROVED", sort_order: 0 },
      { id: PHOTO_2, url: "https://img.example/2.webp", thumb_url: "https://img.example/2-thumb.webp", status: "APPROVED", sort_order: 1 },
    ],
    product_photo_url: null,
    is_owner: true,
    deleted_at: null,
    status: {
      code: "LENT",
      term_occurs_on: null,
      due_date: "2026-10-20T00:00:00",
      counterparty_label: "Anna Kowalska",
    },
    ...overrides,
  };
}

const history: ItemHistoryEntryResponse[] = [
  {
    occurred_at: "2026-10-12T10:00:00",
    movement_type: "LEND",
    description: "Ty → Anna Kowalska",
    term_occurs_on: "2026-10-12T17:00:00",
  },
  {
    occurred_at: "2026-09-03T10:00:00",
    movement_type: "REGISTER",
    description: "Dodana przez: Ty",
    term_occurs_on: null,
  },
];

const categories: Category[] = [
  { id: CAT_STROLLERS, name: "Wózki", description: null, sortOrder: 0, productCount: 1, createdAt: "", updatedAt: "" },
  { id: CAT_TOYS, name: "Zabawki", description: null, sortOrder: 1, productCount: 1, createdAt: "", updatedAt: "" },
];

function renderPage(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/product/:id" element={<ItemDetailPage />} />
        <Route path="/product/:id/edit" element={<ItemEditPage />} />
        <Route path="/panel/wiadomosci/:id" element={<p>Wątek rozmowy</p>} />
      </Routes>
    </MemoryRouter>,
    { wrapper: createQueryWrapper() },
  );
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
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details());
    vi.mocked(itemsApi.getItemHistory).mockResolvedValue(history);
    vi.mocked(categoriesApi.getCategories).mockResolvedValue(categories);
  });

  it("view renders fields, gallery, status and history with an owner Edytuj link", async () => {
    renderPage(`/product/${ITEM_ID}`);

    expect(
      await screen.findByRole("heading", { name: "Wózek spacerowy Baby Jogger" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Wózki · Stan: Dobry")).toBeInTheDocument();
    expect(screen.getByText("Lekki, składany, z daszkiem i koszem.")).toBeInTheDocument();
    expect(screen.getByAltText("Wózek spacerowy Baby Jogger — zdjęcie 1")).toHaveAttribute(
      "referrerpolicy",
      "no-referrer",
    );
    expect(screen.getByRole("button", { name: "Zdjęcie 2 z 2" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByText("Pożyczona do 20.10.2026")).toBeInTheDocument();
    expect(screen.getByText("U: Anna Kowalska")).toBeInTheDocument();

    const list = await screen.findByRole("list", { name: "Historia rzeczy" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Pożyczona")).toBeInTheDocument();
    expect(within(rows[0]).getByText("na terminie 12.10.2026")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Dodana przez: Ty")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: /Edytuj/ })).toHaveAttribute(
      "href",
      `/product/${ITEM_ID}/edit`,
    );
    expect(itemsApi.getItemDetails).toHaveBeenCalledWith(ITEM_ID);
  });

  it("owner_noTextModerationBanner_descriptionVisible", async () => {
    renderPage(`/product/${ITEM_ID}`);

    expect(await screen.findByText("Lekki, składany, z daszkiem i koszem.")).toBeInTheDocument();
    expect(screen.queryByText(/Nazwa i opis są sprawdzane/)).not.toBeInTheDocument();
    expect(screen.queryByText(/odrzucone przez moderację/)).not.toBeInTheDocument();
    expect(screen.queryByText("W moderacji")).not.toBeInTheDocument();
  });

  it("not found for 404 and 400 (malformed id), error state retries", async () => {
    vi.mocked(itemsApi.getItemDetails).mockRejectedValue(new ApiError(404, "Not Found", null));
    const first = renderPage(`/product/${ITEM_ID}`);
    expect(await screen.findByText("Nie znaleziono tej rzeczy.")).toBeInTheDocument();
    first.unmount();

    vi.mocked(itemsApi.getItemDetails).mockRejectedValue(new ApiError(400, "Bad Request", null));
    const second = renderPage("/product/not-a-uuid");
    expect(await screen.findByText("Nie znaleziono tej rzeczy.")).toBeInTheDocument();
    second.unmount();

    vi.mocked(itemsApi.getItemDetails).mockRejectedValueOnce(
      new ApiError(500, "Server Error", { message: "Awaria serwera" }),
    );
    renderPage(`/product/${ITEM_ID}`);
    expect(
      await screen.findByText("Nie udało się wczytać rzeczy — spróbuj ponownie"),
    ).toBeInTheDocument();
    expect(screen.getByText("Awaria serwera")).toBeInTheDocument();

    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details());
    fireEvent.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
    expect(
      await screen.findByRole("heading", { name: "Wózek spacerowy Baby Jogger" }),
    ).toBeInTheDocument();
  });

  it("deleted item shows the banner, no Edytuj, and /edit falls back to the view", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(
      details({
        deleted_at: "2026-10-14T09:00:00",
        status: { code: "DELETED", term_occurs_on: null, due_date: null, counterparty_label: null },
      }),
    );
    renderPage(`/product/${ITEM_ID}/edit`);

    const banner = await screen.findByText("Rzecz usunięta");
    expect(banner.closest('[role="status"]')).not.toBeNull();
    expect(
      screen.getByText("Ta rzecz została usunięta 14.10.2026. Możesz przejrzeć jej historię."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Edycja rzeczy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Edytuj/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edytuj/ })).not.toBeInTheDocument();
  });

  it("non-owner on /edit is redirected to the view with no pencils", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details({ is_owner: false }));
    renderPage(`/product/${ITEM_ID}/edit`);

    expect(
      await screen.findByRole("heading", { name: "Wózek spacerowy Baby Jogger" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Edycja rzeczy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edytuj/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Edytuj/ })).not.toBeInTheDocument();
  });

  it("owner saves condition and the editor closes", async () => {
    vi.mocked(inventoriesApi.updateInventoryItem).mockResolvedValue({} as InventoryItemResponse);
    renderPage(`/product/${ITEM_ID}/edit`);

    fireEvent.click(await screen.findByRole("button", { name: "Edytuj stan" }));
    fireEvent.change(screen.getByLabelText("Stan rzeczy"), { target: { value: "LIKE_NEW" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    await waitFor(() =>
      expect(inventoriesApi.updateInventoryItem).toHaveBeenCalledWith(ITEM_ID, {
        condition: "LIKE_NEW",
      }),
    );
    await waitFor(() => expect(screen.queryByLabelText("Stan rzeczy")).not.toBeInTheDocument());

    vi.mocked(productsApi.updateProductDescription).mockResolvedValue({ description: "Nowy opis" });
    fireEvent.click(screen.getByRole("button", { name: "Edytuj opis" }));
    fireEvent.change(screen.getByLabelText("Opis rzeczy"), { target: { value: "Nowy opis" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() =>
      expect(productsApi.updateProductDescription).toHaveBeenCalledWith(PRODUCT_ID, "Nowy opis"),
    );
  });

  it("name and category save resolves the product, then re-points the item", async () => {
    const resolved = { id: REPOINTED_PRODUCT_ID } as unknown as ProductResponse;
    vi.mocked(productsApi.resolveProduct).mockResolvedValue(resolved);
    vi.mocked(inventoriesApi.updateInventoryItem).mockResolvedValue({} as InventoryItemResponse);
    renderPage(`/product/${ITEM_ID}/edit`);

    fireEvent.click(await screen.findByRole("button", { name: "Edytuj nazwę i kategorię" }));
    expect(
      screen.getByText(/Zdjęcia i opis należą do produktu — po zmianie nazwy lub kategorii rzecz pokaże zdjęcia i opis nowego produktu\./),
    ).toBeInTheDocument();
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(
      details({ product_id: REPOINTED_PRODUCT_ID, name: "Grzechotka", category_id: CAT_TOYS }),
    );
    const nameInput = screen.getByLabelText("Nazwa rzeczy");
    fireEvent.change(nameInput, { target: { value: "Grzechotka" } });
    await screen.findByRole("option", { name: "Zabawki" });
    fireEvent.change(screen.getByLabelText("Typ rzeczy"), { target: { value: CAT_TOYS } });
    fireEvent.keyDown(nameInput, { key: "Enter" });

    await waitFor(() =>
      expect(inventoriesApi.updateInventoryItem).toHaveBeenCalledWith(ITEM_ID, {
        product_id: resolved.id,
      }),
    );
    expect(productsApi.resolveProduct).toHaveBeenCalledWith({
      name: "Grzechotka",
      category_id: CAT_TOYS,
    });

    // The refetched details carry the new product; later product calls use it.
    await waitFor(() => expect(itemsApi.getItemDetails).toHaveBeenCalledTimes(2));
    vi.mocked(productsApi.updateProductDescription).mockResolvedValue({ description: "Opis" });
    const pencil = await screen.findByRole("button", { name: "Edytuj opis" });
    await waitFor(() => expect(pencil).toBeEnabled());
    fireEvent.click(pencil);
    fireEvent.change(screen.getByLabelText("Opis rzeczy"), { target: { value: "Opis" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() =>
      expect(productsApi.updateProductDescription).toHaveBeenCalledWith(
        REPOINTED_PRODUCT_ID,
        "Opis",
      ),
    );
  });

  it("a failed refetch after a re-point locks the photo and description editors with a retry", async () => {
    vi.mocked(productsApi.resolveProduct).mockResolvedValue({
      id: REPOINTED_PRODUCT_ID,
    } as unknown as ProductResponse);
    vi.mocked(inventoriesApi.updateInventoryItem).mockResolvedValue({} as InventoryItemResponse);
    renderPage(`/product/${ITEM_ID}/edit`);

    fireEvent.click(await screen.findByRole("button", { name: "Edytuj nazwę i kategorię" }));
    vi.mocked(itemsApi.getItemDetails).mockRejectedValue(new ApiError(500, "Server Error", null));
    const nameInput = screen.getByLabelText("Nazwa rzeczy");
    fireEvent.change(nameInput, { target: { value: "Grzechotka" } });
    fireEvent.keyDown(nameInput, { key: "Enter" });

    expect(
      await screen.findByText(/zdjęcia i opis są chwilowo zablokowane/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edytuj zdjęcia" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edytuj opis" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edytuj stan" })).toBeEnabled();

    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(
      details({ product_id: REPOINTED_PRODUCT_ID, name: "Grzechotka" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Edytuj opis" })).toBeEnabled());
    expect(screen.queryByText(/chwilowo zablokowane/)).not.toBeInTheDocument();
    expect(productsApi.updateProductDescription).not.toHaveBeenCalled();
  });

  it("a 403 on a description save shows ACCESS_DENIED_MESSAGE inline and keeps the editor open", async () => {
    vi.mocked(productsApi.updateProductDescription).mockRejectedValue(
      new ApiError(403, "Forbidden", { message: "Access denied" }),
    );
    renderPage(`/product/${ITEM_ID}/edit`);

    fireEvent.click(await screen.findByRole("button", { name: "Edytuj opis" }));
    fireEvent.change(screen.getByLabelText("Opis rzeczy"), { target: { value: "Inny opis" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(ACCESS_DENIED_MESSAGE);
    expect(screen.getByLabelText("Opis rzeczy")).toBeInTheDocument();
  });

  it("gallery editor validates files and disables controls while a move is pending", async () => {
    const pending = deferred<productsApi.ProductPhotoResponse[]>();
    vi.mocked(productsApi.reorderProductPhotos).mockReturnValue(pending.promise);
    renderPage(`/product/${ITEM_ID}/edit`);

    fireEvent.click(await screen.findByRole("button", { name: "Edytuj zdjęcia" }));
    expect(
      screen.getByText(/Zdjęcia są wspólne dla wszystkich rzeczy tego produktu\./),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Dodaj zdjęcia"), {
      target: { files: [new File(["x"], "x.gif", { type: "image/gif" })] },
    });
    expect(
      screen.getByText("Nieobsługiwany plik — dodaj zdjęcie JPG, PNG lub WebP"),
    ).toBeInTheDocument();
    expect(productsApi.addProductPhoto).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Przesuń zdjęcie 1 w dół" }));
    await waitFor(() =>
      expect(productsApi.reorderProductPhotos).toHaveBeenCalledWith(PRODUCT_ID, [PHOTO_2, PHOTO_1]),
    );
    expect(screen.getByRole("button", { name: "Usuń zdjęcie 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Przesuń zdjęcie 2 w górę" })).toBeDisabled();
    expect(screen.getByLabelText("Dodaj zdjęcia")).toBeDisabled();

    pending.resolve([]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Usuń zdjęcie 1" })).toBeEnabled(),
    );
    expect(itemsApi.getItemDetails).toHaveBeenCalledTimes(2);
  });

  it("PROPOSED_SWAP copy renders and a history failure stays inside the Historia card", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(
      details({
        status: {
          code: "PROPOSED_SWAP",
          term_occurs_on: null,
          due_date: null,
          counterparty_label: "Ty",
        },
      }),
    );
    vi.mocked(itemsApi.getItemHistory).mockRejectedValue(new ApiError(500, "Server Error", null));
    renderPage(`/product/${ITEM_ID}`);

    expect(
      await screen.findByText("Zaproponowana do zamiany — czeka na decyzję"),
    ).toBeInTheDocument();
    expect(screen.getByText("Dla: Ty")).toBeInTheDocument();
    expect(
      await screen.findByText("Nie udało się wczytać historii — spróbuj ponownie"),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Wózek spacerowy Baby Jogger" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Historia rzeczy" })).not.toBeInTheDocument();
  });
});

describe("ItemDetailPage ask about the item", () => {
  const ASK = "Zapytaj o rzecz";

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(itemsApi.getItemHistory).mockResolvedValue(history);
  });

  it("is shown to a non-owner and hidden for the owner and for a deleted item", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details({ is_owner: false }));
    const { unmount } = renderPage(`/product/${ITEM_ID}`);
    expect(await screen.findByRole("button", { name: ASK })).toBeInTheDocument();
    unmount();

    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details({ is_owner: true }));
    const owner = renderPage(`/product/${ITEM_ID}`);
    await screen.findByRole("heading", { name: "Wózek spacerowy Baby Jogger" });
    expect(screen.queryByRole("button", { name: ASK })).not.toBeInTheDocument();
    owner.unmount();

    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(
      details({ is_owner: false, deleted_at: "2026-10-01T10:00:00" }),
    );
    renderPage(`/product/${ITEM_ID}`);
    await screen.findByText("Rzecz usunięta");
    expect(screen.queryByRole("button", { name: ASK })).not.toBeInTheDocument();
  });

  it("opens the item conversation and navigates to the thread", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details({ is_owner: false }));
    conversationHook.openConversation.mockResolvedValue("conv-9");
    renderPage(`/product/${ITEM_ID}`);

    fireEvent.click(await screen.findByRole("button", { name: ASK }));

    expect(await screen.findByText("Wątek rozmowy")).toBeInTheDocument();
    expect(conversationHook.openConversation).toHaveBeenCalledWith({ kind: "ITEM", id: ITEM_ID });
  });

  it("shows the error inline under the button and stays on the item", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details({ is_owner: false }));
    conversationHook.openConversation.mockRejectedValue(new Error("Za dużo nowych rozmów — spróbuj później"));
    renderPage(`/product/${ITEM_ID}`);

    fireEvent.click(await screen.findByRole("button", { name: ASK }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Za dużo nowych rozmów — spróbuj później");
    expect(screen.getByRole("button", { name: ASK })).toBeEnabled();
  });
});

describe("ItemDetailPage fallbacks", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(itemsApi.getItemHistory).mockResolvedValue(history);
    vi.mocked(categoriesApi.getCategories).mockResolvedValue(categories);
  });

  it("gallery shows the catalog product_photo_url when the product has no photos", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(
      details({ photos: [], product_photo_url: "https://img.example/catalog.jpg" }),
    );
    renderPage(`/product/${ITEM_ID}`);

    const image = await screen.findByAltText("Wózek spacerowy Baby Jogger — zdjęcie 1");
    expect(image).toHaveAttribute("src", "https://img.example/catalog.jpg");
    expect(screen.queryByRole("button", { name: /^Zdjęcie \d z/ })).not.toBeInTheDocument();
  });

  it("Wróć on a directly opened page falls back to /panel/rzeczy", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details());
    render(
      <MemoryRouter initialEntries={[`/product/${ITEM_ID}`]}>
        <Routes>
          <Route path="/product/:id" element={<ItemDetailPage />} />
          <Route path="/panel/rzeczy" element={<p>Panel rzeczy</p>} />
        </Routes>
      </MemoryRouter>,
      { wrapper: createQueryWrapper() },
    );

    await screen.findByRole("heading", { name: "Wózek spacerowy Baby Jogger" });
    fireEvent.click(screen.getByRole("button", { name: /Wróć/ }));
    expect(await screen.findByText("Panel rzeczy")).toBeInTheDocument();
  });

  it("a missing category renders a fallback instead of null", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details({ category_name: null }));
    renderPage(`/product/${ITEM_ID}`);

    expect(await screen.findByText("Bez kategorii · Stan: Dobry")).toBeInTheDocument();
    expect(screen.queryByText(/null/)).not.toBeInTheDocument();
  });

  it("Moje rzeczy → edit → Gotowe → Wróć returns to Moje rzeczy; Edytuj → Gotowe never leaves the editor in history", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details());
    render(
      <MemoryRouter initialEntries={["/panel/rzeczy"]}>
        <Routes>
          <Route
            path="/panel/rzeczy"
            element={
              <>
                <Link to={`/product/${ITEM_ID}`}>Otwórz rzecz</Link>
                <Link to={`/product/${ITEM_ID}/edit`}>Edytuj rzecz</Link>
              </>
            }
          />
          <Route path="/product/:id" element={<ItemDetailPage />} />
          <Route path="/product/:id/edit" element={<ItemEditPage />} />
        </Routes>
      </MemoryRouter>,
      { wrapper: createQueryWrapper() },
    );
    const backToList = async () => {
      fireEvent.click(await screen.findByRole("button", { name: /^Wróć$/ }));
      expect(await screen.findByRole("link", { name: "Otwórz rzecz" })).toBeInTheDocument();
    };

    fireEvent.click(await screen.findByRole("link", { name: "Edytuj rzecz" }));
    fireEvent.click(await screen.findByRole("link", { name: "Gotowe" }));
    await backToList();

    fireEvent.click(screen.getByRole("link", { name: "Edytuj rzecz" }));
    fireEvent.click(await screen.findByRole("link", { name: /Wróć do podglądu/ }));
    await backToList();

    // From the view, Edytuj pushes; Gotowe replaces the editor, so Wróć
    // lands on the view, never on the editor.
    fireEvent.click(screen.getByRole("link", { name: "Otwórz rzecz" }));
    fireEvent.click(await screen.findByRole("link", { name: /Edytuj/ }));
    fireEvent.click(await screen.findByRole("link", { name: "Gotowe" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Wróć$/ }));
    await screen.findByRole("heading", { name: "Wózek spacerowy Baby Jogger" });
    expect(screen.queryByRole("heading", { name: "Edycja rzeczy" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Edytuj/ })).toBeInTheDocument();
  });

  it.each([
    ["view", `/product/${ITEM_ID}`, "Wózek spacerowy Baby Jogger"],
    ["edit", `/product/${ITEM_ID}/edit`, "Edycja rzeczy"],
  ])("%s page shows the panel bottom nav with no tab active; Moje rzeczy leads to /panel/rzeczy", async (_, path, heading) => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details());
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/product/:id" element={<ItemDetailPage />} />
          <Route path="/product/:id/edit" element={<ItemEditPage />} />
          <Route path="/panel/rzeczy" element={<p>Panel rzeczy</p>} />
        </Routes>
      </MemoryRouter>,
      { wrapper: createQueryWrapper() },
    );
    await screen.findByRole("heading", { name: heading });

    const nav = screen.getByRole("navigation", { name: "Nawigacja panelu" });
    const rzeczy = within(nav).getByRole("button", { name: "Moje rzeczy" });
    expect(rzeczy).toHaveAttribute("aria-current", "false");
    expect(within(nav).getByRole("button", { name: "Spotkania" })).toHaveAttribute("aria-current", "false");

    fireEvent.click(rzeczy);
    expect(await screen.findByText("Panel rzeczy")).toBeInTheDocument();
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
  });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 13, 12, 0));
    vi.mocked(itemsApi.getItemHistory).mockResolvedValue(history);
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
    renderPage(`/product/${ITEM_ID}`);

    const line = await screen.findByText("Zarezerwowana — odbiór w śr 14.10 o 16:30 · Muzyczne Maluchy");
    expect(line).toHaveAttribute("role", "status");
    expect(screen.getByText("Dla: Anna K.")).toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: /Dodaj do kalendarza/ });
    expect(line).not.toContainElement(trigger);
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  });

  it("owner gets a Przekazanie title with the Term link in the details", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(
      details({ is_owner: true, status: partyStatus("RESERVED") }),
    );
    renderPage(`/product/${ITEM_ID}`);

    const url = await openCalendarMenu();
    expect(url.searchParams.get("text")).toBe("Przekazanie: Wózek spacerowy Baby Jogger");
    expect(url.searchParams.get("details")).toContain(
      `${window.location.origin}/krag/grupa/${GROUP_ID}/term/${TERM_ID}`,
    );
  });

  it("non-owner party in transit gets an Odbiór title and the W drodze line", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(
      details({ is_owner: false, status: partyStatus("IN_TRANSIT") }),
    );
    renderPage(`/product/${ITEM_ID}`);

    expect(
      await screen.findByText("W drodze — odbiór w śr 14.10 o 16:30 · Muzyczne Maluchy"),
    ).toBeInTheDocument();
    const url = await openCalendarMenu();
    expect(url.searchParams.get("text")).toBe("Odbiór: Wózek spacerowy Baby Jogger");
  });

  it("party view hides the calendar trigger once the Term has passed but keeps the dated line", async () => {
    vi.setSystemTime(new Date(2026, 9, 14, 17, 0));
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details({ status: partyStatus("RESERVED") }));
    renderPage(`/product/${ITEM_ID}`);

    expect(
      await screen.findByText("Zarezerwowana — odbiór w śr 14.10 o 16:30 · Muzyczne Maluchy"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Dodaj do kalendarza/ })).not.toBeInTheDocument();
  });

  it("non-party viewer keeps the DD.MM text and gets no calendar trigger", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(
      details({
        is_owner: false,
        status: { ...partyStatus("RESERVED"), term_id: null, group_id: null, group_name: null },
      }),
    );
    renderPage(`/product/${ITEM_ID}`);

    expect(await screen.findByText("Zarezerwowana — odbiór na terminie 14.10")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Dodaj do kalendarza/ })).not.toBeInTheDocument();
  });
});

describe("ItemEditPage photo moderation notice", () => {
  const NOTICE =
    "Rzecz zdjęta z terminów do czasu zatwierdzenia zdjęć. Tryb wypożyczę/oddam/zamienię włączysz ponownie w „Moje rzeczy”.";

  function withSecondPhoto(status: productsApi.ModerationStatus): ItemDetailsResponse {
    const base = details();
    return details({ photos: [base.photos[0], { ...base.photos[1], status }] });
  }

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(itemsApi.getItemHistory).mockResolvedValue(history);
    vi.mocked(categoriesApi.getCategories).mockResolvedValue(categories);
  });

  it.each(["PENDING", "NEEDS_REVIEW"] as const)(
    "edit page shows role=status notice with link to /panel/rzeczy when a photo is %s",
    async (status) => {
      vi.mocked(itemsApi.getItemDetails).mockResolvedValue(withSecondPhoto(status));
      renderPage(`/product/${ITEM_ID}/edit`);

      await screen.findByRole("heading", { name: "Edycja rzeczy" });
      const notice = screen
        .getAllByRole("status")
        .find((el) => el.textContent?.includes("Rzecz zdjęta z terminów"));
      if (!notice) throw new Error("moderation notice not rendered");
      expect(notice).toHaveTextContent(NOTICE);
      expect(within(notice).getByRole("link", { name: "Moje rzeczy →" })).toHaveAttribute(
        "href",
        "/panel/rzeczy",
      );
      // Placed before the photos card.
      const photosHeading = screen.getByRole("heading", { name: /^Zdjęcia \(/ });
      expect(
        notice.compareDocumentPosition(photosHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    },
  );

  it("edit page hides the notice when all photos are APPROVED/REJECTED; the view never shows it", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(withSecondPhoto("REJECTED"));
    const { unmount } = renderPage(`/product/${ITEM_ID}/edit`);

    await screen.findByRole("heading", { name: "Edycja rzeczy" });
    expect(screen.queryByText(/Rzecz zdjęta z terminów/)).not.toBeInTheDocument();
    unmount();

    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(withSecondPhoto("PENDING"));
    renderPage(`/product/${ITEM_ID}`);
    await screen.findByRole("heading", { name: "Wózek spacerowy Baby Jogger" });
    expect(screen.queryByText(/Rzecz zdjęta z terminów/)).not.toBeInTheDocument();
  });

  it("gallery helper text contains the appended sentence", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details());
    renderPage(`/product/${ITEM_ID}/edit`);

    fireEvent.click(await screen.findByRole("button", { name: "Edytuj zdjęcia" }));
    expect(
      screen.getByText(
        "Zdjęcia są wspólne dla wszystkich rzeczy tego produktu. Inni zobaczą je po sprawdzeniu. " +
          "Nowe zdjęcie zdejmuje te rzeczy z terminów do czasu jego zatwierdzenia.",
      ),
    ).toBeInTheDocument();
  });
});
