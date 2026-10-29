import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Link, MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemDetailPage } from "../pages/product/ItemDetailPage";
import * as itemsApi from "../api/items";
import * as inventoriesApi from "../api/inventories";
import * as productsApi from "../api/products";
import * as categoriesApi from "../api/categories";
import { ApiError } from "../api/client";
import { ACCESS_DENIED_MESSAGE } from "../api/problem";
import type { ItemDetailsResponse } from "../api/items";
import type { Category } from "../api/categories";
import type { InventoryItemResponse } from "../api/inventories";
import type { ProductResponse } from "../api/products";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/items", () => ({
  getItemDetails: vi.fn(),
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
const CAT_KIDS = "6f801a21-3b4c-4d5e-8f60-7b8c9d0e1f2a";
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
    listing_status: "DRAFT",
    status: {
      code: "LENT",
      term_occurs_on: null,
      due_date: "2026-10-20T00:00:00",
      counterparty_label: "Anna Kowalska",
    },
    ...overrides,
  };
}

function category(id: string, name: string, parent_id: string | null, sort_order: number): Category {
  return { id, name, description: null, parent_id, sort_order, product_count: 1, created_at: "", updated_at: "" };
}

const categories: Category[] = [
  category(CAT_KIDS, "Dzieci", null, 0),
  category(CAT_STROLLERS, "Wózki", CAT_KIDS, 0),
  category(CAT_TOYS, "Zabawki", CAT_KIDS, 1),
];

function renderPage(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/product/:id" element={<ItemDetailPage />} />
        <Route path="/product/:id/edit" element={<Navigate to="..?edit=1" relative="path" replace />} />
        <Route path="/messages/:id" element={<p>Wątek rozmowy</p>} />
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
    vi.mocked(categoriesApi.getCategories).mockResolvedValue(categories);
  });

  it("view renders fields, gallery and status with an owner Edytuj button, and no history", async () => {
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

    expect(screen.queryByText("Historia")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Edytuj/ })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Edycja rzeczy" })).not.toBeInTheDocument();
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

  it("deleted item shows the banner and no Edytuj, and ?edit=1 stays in view mode", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(
      details({
        deleted_at: "2026-10-14T09:00:00",
        status: { code: "DELETED", term_occurs_on: null, due_date: null, counterparty_label: null },
      }),
    );
    renderPage(`/product/${ITEM_ID}?edit=1`);

    const banner = await screen.findByText("Rzecz usunięta");
    expect(banner.closest('[role="status"]')).not.toBeNull();
    expect(
      screen.getByText("Ta rzecz została usunięta 14.10.2026."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Edycja rzeczy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edytuj/ })).not.toBeInTheDocument();
  });

  it("a non-owner on the old /edit address sees the view with no edit controls", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details({ is_owner: false }));
    renderPage(`/product/${ITEM_ID}/edit`);

    expect(
      await screen.findByRole("heading", { name: "Wózek spacerowy Baby Jogger" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Edycja rzeczy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edytuj/ })).not.toBeInTheDocument();
  });

  it("Edytuj turns the fields into inputs on the same page; Zapisz saves condition and description together", async () => {
    vi.mocked(inventoriesApi.updateInventoryItem).mockResolvedValue({} as InventoryItemResponse);
    vi.mocked(productsApi.updateProductDescription).mockResolvedValue({ description: "Nowy opis" });
    renderPage(`/product/${ITEM_ID}`);

    fireEvent.click(await screen.findByRole("button", { name: /Edytuj/ }));
    const form = screen.getByRole("form", { name: "Edycja rzeczy" });
    expect(within(form).getByLabelText("Nazwa")).toHaveValue("Wózek spacerowy Baby Jogger");
    expect(within(form).getByLabelText("Nazwa")).toHaveFocus();
    expect(within(form).getByLabelText("Opis")).toHaveValue("Lekki, składany, z daszkiem i koszem.");
    expect(within(form).getByLabelText("Stan")).toHaveValue("GOOD");
    expect(await within(form).findByRole("button", { name: /^Kategoria Dzieci ›\s+Wózki/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Wózek spacerowy Baby Jogger" })).not.toBeInTheDocument();

    fireEvent.change(within(form).getByLabelText("Stan"), { target: { value: "LIKE_NEW" } });
    fireEvent.change(within(form).getByLabelText("Opis"), { target: { value: "Nowy opis" } });
    fireEvent.click(within(form).getByRole("button", { name: "Zapisz" }));

    await waitFor(() =>
      expect(productsApi.updateProductDescription).toHaveBeenCalledWith(PRODUCT_ID, "Nowy opis"),
    );
    await waitFor(() =>
      expect(inventoriesApi.updateInventoryItem).toHaveBeenCalledWith(ITEM_ID, { condition: "LIKE_NEW" }),
    );
    expect(productsApi.resolveProduct).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("form", { name: "Edycja rzeczy" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Edytuj/ })).toHaveFocus();
  });

  it("Anuluj leaves edit mode without saving", async () => {
    renderPage(`/product/${ITEM_ID}?edit=1`);

    const form = await screen.findByRole("form", { name: "Edycja rzeczy" });
    fireEvent.change(within(form).getByLabelText("Nazwa"), { target: { value: "Inna nazwa" } });
    fireEvent.click(within(form).getByRole("button", { name: "Anuluj" }));

    expect(await screen.findByRole("heading", { name: "Wózek spacerowy Baby Jogger" })).toBeInTheDocument();
    expect(inventoriesApi.updateInventoryItem).not.toHaveBeenCalled();
    expect(productsApi.updateProductDescription).not.toHaveBeenCalled();
  });

  it("a name and category change locks the description, then resolves the product and re-points the item", async () => {
    const resolved = { id: REPOINTED_PRODUCT_ID } as unknown as ProductResponse;
    vi.mocked(productsApi.resolveProduct).mockResolvedValue(resolved);
    vi.mocked(inventoriesApi.updateInventoryItem).mockResolvedValue({} as InventoryItemResponse);
    renderPage(`/product/${ITEM_ID}?edit=1`);

    const form = await screen.findByRole("form", { name: "Edycja rzeczy" });
    fireEvent.change(within(form).getByLabelText("Nazwa"), { target: { value: "Grzechotka" } });
    expect(
      within(form).getByText(/Zdjęcia i opis należą do produktu — po zmianie nazwy lub kategorii rzecz pokaże zdjęcia i opis nowego produktu\./),
    ).toBeInTheDocument();
    expect(within(form).getByLabelText("Opis")).toBeDisabled();
    const picker = await within(form).findByRole("button", { name: /^Kategoria Dzieci ›\s+Wózki/ });
    fireEvent.click(picker);
    fireEvent.click(await screen.findByRole("button", { name: "Zabawki" }));
    expect(await within(form).findByRole("button", { name: /^Kategoria Dzieci ›\s+Zabawki/ })).toBeInTheDocument();

    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(
      details({ product_id: REPOINTED_PRODUCT_ID, name: "Grzechotka", category_id: CAT_TOYS }),
    );
    fireEvent.click(within(form).getByRole("button", { name: "Zapisz" }));

    await waitFor(() =>
      expect(inventoriesApi.updateInventoryItem).toHaveBeenCalledWith(ITEM_ID, { product_id: resolved.id }),
    );
    expect(productsApi.resolveProduct).toHaveBeenCalledWith({ name: "Grzechotka", category_id: CAT_TOYS });
    expect(productsApi.updateProductDescription).not.toHaveBeenCalled();
    expect(await screen.findByRole("heading", { name: "Grzechotka" })).toBeInTheDocument();
  });

  it("a failed details refetch locks photos and the description with a retry", async () => {
    vi.mocked(inventoriesApi.updateInventoryItem).mockResolvedValue({} as InventoryItemResponse);
    renderPage(`/product/${ITEM_ID}?edit=1`);

    const form = await screen.findByRole("form", { name: "Edycja rzeczy" });
    vi.mocked(itemsApi.getItemDetails).mockRejectedValue(new ApiError(500, "Server Error", null));
    fireEvent.change(within(form).getByLabelText("Stan"), { target: { value: "FAIR" } });
    fireEvent.click(within(form).getByRole("button", { name: "Zapisz" }));
    fireEvent.click(await screen.findByRole("button", { name: /Edytuj/ }));

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

  it("a 403 on a description save shows ACCESS_DENIED_MESSAGE inline and stays in edit mode", async () => {
    vi.mocked(productsApi.updateProductDescription).mockRejectedValue(
      new ApiError(403, "Forbidden", { message: "Access denied" }),
    );
    renderPage(`/product/${ITEM_ID}?edit=1`);

    const form = await screen.findByRole("form", { name: "Edycja rzeczy" });
    fireEvent.change(within(form).getByLabelText("Opis"), { target: { value: "Inny opis" } });
    fireEvent.click(within(form).getByRole("button", { name: "Zapisz" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent(ACCESS_DENIED_MESSAGE);
    expect(within(form).getByLabelText("Opis")).toHaveValue("Inny opis");
  });

  it("each photo is edited on its own: files are validated and controls lock while a move is pending", async () => {
    const pending = deferred<productsApi.ProductPhotoResponse[]>();
    vi.mocked(productsApi.reorderProductPhotos).mockReturnValue(pending.promise);
    renderPage(`/product/${ITEM_ID}?edit=1`);

    await screen.findByRole("form", { name: "Edycja rzeczy" });
    expect(screen.getByText("Zdjęcia (2/10)")).toBeInTheDocument();
    expect(screen.getByText("Zmiany zdjęć zapisują się od razu.")).toBeInTheDocument();
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

    vi.mocked(productsApi.deleteProductPhoto).mockResolvedValue(undefined);
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
        },
      }),
    );
    renderPage(`/product/${ITEM_ID}`);

    expect(
      await screen.findByText("Zaproponowana do zamiany — czeka na decyzję"),
    ).toBeInTheDocument();
    expect(screen.getByText("Dla: Ty")).toBeInTheDocument();
  });
});

describe("ItemDetailPage ask about the item", () => {
  const ASK = "Zapytaj o rzecz";

  beforeEach(() => {
    vi.resetAllMocks();
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

  it("Wróć on a directly opened page falls back to /items", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details());
    render(
      <MemoryRouter initialEntries={[`/product/${ITEM_ID}`]}>
        <Routes>
          <Route path="/product/:id" element={<ItemDetailPage />} />
          <Route path="/items" element={<p>Panel rzeczy</p>} />
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

  it("edit mode never adds a history entry: Moje rzeczy → edit → Anuluj → Wróć returns to Moje rzeczy", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details());
    render(
      <MemoryRouter initialEntries={["/items"]}>
        <Routes>
          <Route
            path="/items"
            element={
              <>
                <Link to={`/product/${ITEM_ID}`}>Otwórz rzecz</Link>
                <Link to={`/product/${ITEM_ID}?edit=1`}>Edytuj rzecz</Link>
              </>
            }
          />
          <Route path="/product/:id" element={<ItemDetailPage />} />
        </Routes>
      </MemoryRouter>,
      { wrapper: createQueryWrapper() },
    );
    const backToList = async () => {
      fireEvent.click(await screen.findByRole("button", { name: /^Wróć$/ }));
      expect(await screen.findByRole("link", { name: "Otwórz rzecz" })).toBeInTheDocument();
    };

    fireEvent.click(await screen.findByRole("link", { name: "Edytuj rzecz" }));
    fireEvent.click(await screen.findByRole("button", { name: "Anuluj" }));
    await backToList();

    fireEvent.click(screen.getByRole("link", { name: "Otwórz rzecz" }));
    fireEvent.click(await screen.findByRole("button", { name: /Edytuj/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Anuluj" }));
    await backToList();
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
      `${window.location.origin}/krag/group/${GROUP_ID}/term/${TERM_ID}`,
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

describe("Item edit mode status chip and photo hints", () => {
  function withSecondPhoto(status: productsApi.ModerationStatus): ItemDetailsResponse {
    const base = details();
    return details({ photos: [base.photos[0], { ...base.photos[1], status }] });
  }

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(categoriesApi.getCategories).mockResolvedValue(categories);
  });

  it.each([
    ["DRAFT", "Wersja robocza"],
    ["ACTIVE", "Aktywna"],
  ] as const)("edit mode shows the %s status chip next to its heading", async (listing_status, label) => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details({ listing_status }));
    renderPage(`/product/${ITEM_ID}?edit=1`);

    const heading = await screen.findByRole("heading", { name: "Edycja rzeczy" });
    expect(heading.parentElement).toHaveTextContent(label);
    expect(screen.queryByText(label === "Aktywna" ? "Wersja robocza" : "Aktywna")).not.toBeInTheDocument();
  });

  it.each(["PENDING", "NEEDS_REVIEW"] as const)(
    "edit mode shows no moderation notice when a photo is %s",
    async (status) => {
      vi.mocked(itemsApi.getItemDetails).mockResolvedValue(withSecondPhoto(status));
      renderPage(`/product/${ITEM_ID}?edit=1`);

      await screen.findByRole("heading", { name: "Edycja rzeczy" });
      expect(screen.queryByText(/Rzecz zdjęta z terminów/)).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Moje rzeczy →" })).not.toBeInTheDocument();
    },
  );

  it("gallery helper text no longer claims a new photo withdraws the item", async () => {
    vi.mocked(itemsApi.getItemDetails).mockResolvedValue(details());
    renderPage(`/product/${ITEM_ID}?edit=1`);

    expect(
      await screen.findByText("Zdjęcia są wspólne dla wszystkich rzeczy tego produktu. Inni zobaczą je po sprawdzeniu."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Nowe zdjęcie zdejmuje/)).not.toBeInTheDocument();
  });
});
