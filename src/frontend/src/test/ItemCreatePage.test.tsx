import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ItemCreatePage } from "../pages/product/ItemCreatePage";
import { FailedPhotosNotice } from "../pages/product/ItemDetailPage";
import * as inventoriesApi from "../api/inventories";
import * as peopleApi from "../api/people";
import * as productsApi from "../api/products";
import * as categoriesApi from "../api/categories";
import { ApiError } from "../api/client";
import type { Category } from "../api/categories";
import type { InventoryItemResponse, InventoryResponse } from "../api/inventories";
import type { UserProfileResponse } from "../api/people";
import type { ProductResponse } from "../api/products";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/inventories", () => ({
  getOrCreatePersonalInventory: vi.fn(),
  registerInventoryItem: vi.fn(),
}));

vi.mock("../api/people", () => ({
  getMyProfile: vi.fn(),
}));

vi.mock("../api/products", () => ({
  resolveProduct: vi.fn(),
  addProductPhoto: vi.fn(),
}));

vi.mock("../api/categories", () => ({
  getCategories: vi.fn(),
}));

// Ids are UUID strings at runtime; some API types still declare `number`.
const ACCOUNT_USER_ID = "0b1c2d3e-4f50-4617-8a29-3b4c5d6e7f80";
const INVENTORY_ID = "1c2d3e4f-5061-4728-9b3a-4c5d6e7f8091";
const PRODUCT_ID = "2d3e4f50-6172-4839-8c4b-5d6e7f8091a2";
const NEW_ITEM_ID = "3e4f5061-7283-494a-9d5c-6e7f8091a2b3";
const CAT_STROLLERS = "4f506172-8394-4a5b-8e6d-7f8091a2b3c4";
const CAT_TOYS = "50617283-94a5-4b6c-9f7e-8091a2b3c4d5";

function category(id: string, name: string, sortOrder: number): Category {
  return { id, name, description: null, sortOrder, productCount: 0, createdAt: "", updatedAt: "" };
}

function NewItemProbe() {
  const { id } = useParams();
  return (
    <>
      <p>ITEM PAGE {id}</p>
      <FailedPhotosNotice />
    </>
  );
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/product/new"]}>
      <Routes>
        <Route path="/product/new" element={<ItemCreatePage />} />
        <Route path="/product/:id" element={<NewItemProbe />} />
        <Route path="/panel/rzeczy" element={<p>PANEL RZECZY</p>} />
      </Routes>
    </MemoryRouter>,
    { wrapper: createQueryWrapper() },
  );
}

/** Waits for the categories so later state updates stay inside act(). */
async function renderLoadedPage() {
  renderPage();
  await waitFor(() => expect(screen.getByLabelText("Typ")).toHaveValue(CAT_STROLLERS));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(categoriesApi.getCategories).mockResolvedValue([
    category(CAT_STROLLERS, "Wózki", 0),
    category(CAT_TOYS, "Zabawki", 1),
  ]);
  vi.mocked(peopleApi.getMyProfile).mockResolvedValue({
    account_user_id: ACCOUNT_USER_ID,
  } as unknown as UserProfileResponse);
  vi.mocked(inventoriesApi.getOrCreatePersonalInventory).mockResolvedValue({
    id: INVENTORY_ID,
  } as unknown as InventoryResponse);
  vi.mocked(productsApi.resolveProduct).mockResolvedValue({
    id: PRODUCT_ID,
  } as unknown as ProductResponse);
  vi.mocked(inventoriesApi.registerInventoryItem).mockResolvedValue({
    id: NEW_ITEM_ID,
  } as unknown as InventoryItemResponse);
});

describe("ItemCreatePage", () => {
  it("renders the heading and the Nazwa/Stan/Typ form with the first category preselected", async () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Dodaj rzecz" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nazwa")).toBeInTheDocument();
    expect(screen.getByLabelText("Stan")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Typ")).toHaveValue(CAT_STROLLERS));
    expect(screen.getByRole("button", { name: "Wróć" })).toBeInTheDocument();
  });

  it("keeps the submit button disabled while the name is empty", async () => {
    await renderLoadedPage();
    const submit = screen.getByRole("button", { name: "Dodaj rzecz" });

    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Nazwa"), { target: { value: "   " } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Nazwa"), { target: { value: "Rowerek" } });
    expect(submit).toBeEnabled();
  });

  it("resolves the product, registers the item in the personal inventory and opens its page", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Typ")).toHaveValue(CAT_STROLLERS));

    fireEvent.change(screen.getByLabelText("Nazwa"), { target: { value: "  Rowerek  " } });
    fireEvent.change(screen.getByLabelText("Typ"), { target: { value: CAT_TOYS } });
    fireEvent.change(screen.getByLabelText("Stan"), { target: { value: "LIKE_NEW" } });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj rzecz" }));

    expect(await screen.findByText(`ITEM PAGE ${NEW_ITEM_ID}`)).toBeInTheDocument();
    expect(inventoriesApi.getOrCreatePersonalInventory).toHaveBeenCalledWith(ACCOUNT_USER_ID);
    expect(productsApi.resolveProduct).toHaveBeenCalledWith({ name: "Rowerek", category_id: CAT_TOYS });
    expect(inventoriesApi.registerInventoryItem).toHaveBeenCalledWith({
      inventory_id: INVENTORY_ID,
      product_id: PRODUCT_ID,
      condition: "LIKE_NEW",
    });
  });

  it("shows an inline message and stays on the form when adding fails", async () => {
    vi.mocked(productsApi.resolveProduct).mockRejectedValue(
      new ApiError(409, "Conflict", { message: "Taka rzecz już istnieje" }),
    );
    renderPage();

    fireEvent.change(screen.getByLabelText("Nazwa"), { target: { value: "Rowerek" } });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj rzecz" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Taka rzecz już istnieje");
    expect(inventoriesApi.registerInventoryItem).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Dodaj rzecz" })).toBeEnabled();
  });

  it("falls back to a Polish message for an unexpected error", async () => {
    vi.mocked(inventoriesApi.registerInventoryItem).mockRejectedValue(new ApiError(500, "Server Error", null));
    renderPage();

    fireEvent.change(screen.getByLabelText("Nazwa"), { target: { value: "Rowerek" } });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj rzecz" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się dodać rzeczy. Spróbuj ponownie.");
  });

  describe("photos", () => {
    const PHOTO_A = "https://img.example/a.jpg";
    const PHOTO_B = "https://img.example/b.jpg";

    function addPhoto(url: string) {
      fireEvent.change(screen.getByLabelText("Link do zdjęcia"), { target: { value: url } });
      fireEvent.click(screen.getByRole("button", { name: "+ Dodaj" }));
    }

    it("adds a photo link to the list and removes it again", async () => {
      await renderLoadedPage();

      addPhoto(PHOTO_A);
      expect(screen.getByText(`1. ${PHOTO_A}`)).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Zdjęcia (1/10)" })).toBeInTheDocument();
      expect(screen.getByLabelText("Link do zdjęcia")).toHaveValue("");

      fireEvent.click(screen.getByRole("button", { name: "Usuń zdjęcie 1" }));
      expect(screen.queryByText(`1. ${PHOTO_A}`)).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Zdjęcia (0/10)" })).toBeInTheDocument();
    });

    it("rejects an invalid link with a message and keeps the list empty", async () => {
      await renderLoadedPage();

      addPhoto("ftp://img.example/a.jpg");

      expect(screen.getByRole("alert")).toHaveTextContent(
        "Podaj poprawny link zaczynający się od http:// lub https://",
      );
      expect(screen.queryByRole("button", { name: "Usuń zdjęcie 1" })).not.toBeInTheDocument();
    });

    it("adds every photo in order with the resolved product id after registering the item", async () => {
      vi.mocked(productsApi.addProductPhoto).mockResolvedValue(
        {} as Awaited<ReturnType<typeof productsApi.addProductPhoto>>,
      );
      renderPage();

      fireEvent.change(screen.getByLabelText("Nazwa"), { target: { value: "Rowerek" } });
      addPhoto(PHOTO_A);
      addPhoto(PHOTO_B);
      fireEvent.click(screen.getByRole("button", { name: "Dodaj rzecz" }));

      expect(await screen.findByText(`ITEM PAGE ${NEW_ITEM_ID}`)).toBeInTheDocument();
      expect(vi.mocked(productsApi.addProductPhoto).mock.calls).toEqual([
        [PRODUCT_ID, PHOTO_A],
        [PRODUCT_ID, PHOTO_B],
      ]);
      const registerOrder = vi.mocked(inventoriesApi.registerInventoryItem).mock.invocationCallOrder[0];
      const firstPhotoOrder = vi.mocked(productsApi.addProductPhoto).mock.invocationCallOrder[0];
      expect(registerOrder).toBeLessThan(firstPhotoOrder);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("still opens the new item when a photo is refused and tells how many failed", async () => {
      vi.mocked(productsApi.addProductPhoto)
        .mockRejectedValueOnce(new ApiError(409, "Conflict", { message: "Duplikat" }))
        .mockResolvedValueOnce({} as Awaited<ReturnType<typeof productsApi.addProductPhoto>>);
      renderPage();

      fireEvent.change(screen.getByLabelText("Nazwa"), { target: { value: "Rowerek" } });
      addPhoto(PHOTO_A);
      addPhoto(PHOTO_B);
      fireEvent.click(screen.getByRole("button", { name: "Dodaj rzecz" }));

      expect(await screen.findByText(`ITEM PAGE ${NEW_ITEM_ID}`)).toBeInTheDocument();
      expect(productsApi.addProductPhoto).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("status")).toHaveTextContent("nie udało się dodać części zdjęć (1)");
    });
  });

  it("shows the panel bottom nav with Moje rzeczy active, leading to /panel/rzeczy", async () => {
    await renderLoadedPage();

    const nav = screen.getByRole("navigation", { name: "Nawigacja panelu" });
    const rzeczy = within(nav).getByRole("button", { name: "Moje rzeczy" });
    expect(rzeczy).toHaveAttribute("aria-current", "true");
    expect(within(nav).getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "false");

    fireEvent.click(rzeczy);
    expect(await screen.findByText("PANEL RZECZY")).toBeInTheDocument();
  });
});
