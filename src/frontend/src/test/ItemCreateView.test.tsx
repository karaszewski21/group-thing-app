import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ItemCreateView } from "../pages/add/ItemCreateView";
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
  updateProductDescription: vi.fn(),
}));

vi.mock("../api/categories", () => ({
  getCategories: vi.fn(),
}));

// Ids are UUID strings at runtime; some API types still declare `number`.
const ACCOUNT_USER_ID = "0b1c2d3e-4f50-4617-8a29-3b4c5d6e7f80";
const INVENTORY_ID = "1c2d3e4f-5061-4728-9b3a-4c5d6e7f8091";
const PRODUCT_ID = "2d3e4f50-6172-4839-8c4b-5d6e7f8091a2";
const NEW_ITEM_ID = "3e4f5061-7283-494a-9d5c-6e7f8091a2b3";
const CAT_KIDS = "4f506172-8394-4a5b-8e6d-7f8091a2b3c4";
const CAT_STROLLERS = "50617283-94a5-4b6c-9f7e-8091a2b3c4d5";
const CAT_TOYS = "6172839a-a5b6-4c7d-8e8f-91a2b3c4d5e6";

const GIFT_LIMIT_MESSAGE =
  "Możesz mieć maksymalnie 10 rzeczy do oddania. Wybierz „Zamienię” albo zapisz wersję roboczą.";

function category(id: string, name: string, parent_id: string | null, sort_order: number): Category {
  return {
    id,
    name,
    description: null,
    parent_id,
    sort_order,
    product_count: 0,
    created_at: "",
    updated_at: "",
  };
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
    <MemoryRouter initialEntries={["/add/product"]}>
      <Routes>
        <Route path="/add/product" element={<ItemCreateView />} />
        <Route path="/product/:id" element={<NewItemProbe />} />
      </Routes>
    </MemoryRouter>,
    { wrapper: createQueryWrapper() },
  );
}

function categoryTrigger() {
  return screen.getByRole("button", { name: /^Kategoria/ });
}

function actionButtons() {
  return ["Oddam", "Zamienię", "Wersja robocza"].map((name) => screen.getByRole("button", { name }));
}

/** Picks Dzieci › Wózki through the tree picker sheet. */
async function chooseStrollers() {
  categoryTrigger().focus();
  fireEvent.click(categoryTrigger());
  fireEvent.click(await screen.findByRole("button", { name: "Dzieci" }));
  fireEvent.click(screen.getByRole("button", { name: "Wózki" }));
  await waitFor(() => expect(categoryTrigger()).toHaveTextContent("Wózki"));
}

async function fillForm(name = "Rowerek") {
  renderPage();
  fireEvent.change(screen.getByLabelText("Nazwa"), { target: { value: name } });
  await chooseStrollers();
}

function addPhoto(file: File) {
  fireEvent.change(screen.getByLabelText("Dodaj zdjęcia"), { target: { files: [file] } });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(categoriesApi.getCategories).mockResolvedValue([
    category(CAT_KIDS, "Dzieci", null, 0),
    category(CAT_STROLLERS, "Wózki", CAT_KIDS, 0),
    category(CAT_TOYS, "Zabawki", CAT_KIDS, 1),
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
  let preview = 0;
  URL.createObjectURL = vi.fn(() => `blob:preview-${(preview += 1)}`);
  URL.revokeObjectURL = vi.fn();
});

describe("ItemCreateView", () => {
  it("keeps Oddam, Zamienię and Wersja robocza aria-disabled until a name and a category are set", async () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Dodaj rzecz" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Typ")).not.toBeInTheDocument();
    expect(screen.queryByText(/Moje rzeczy/)).not.toBeInTheDocument();
    for (const button of actionButtons()) {
      expect(button).toHaveAttribute("type", "button");
      expect(button).toHaveAttribute("aria-disabled", "true");
      // Still focusable, so keyboard users reach the missing-fields hint.
      expect(button).toBeEnabled();
      button.focus();
      expect(button).toHaveFocus();
    }

    fireEvent.change(screen.getByLabelText("Nazwa"), { target: { value: "   " } });
    await chooseStrollers();
    for (const button of actionButtons()) {
      expect(button).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(button);
    }
    expect(productsApi.resolveProduct).not.toHaveBeenCalled();
    expect(inventoriesApi.registerInventoryItem).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Nazwa"), { target: { value: "Rowerek" } });
    for (const button of actionButtons()) {
      expect(button).toBeEnabled();
      expect(button).not.toHaveAttribute("aria-disabled");
    }
  });

  it("tells screen-reader users why the disabled actions are disabled", async () => {
    const hint = "Podaj nazwę i wybierz kategorię, aby zapisać.";
    renderPage();

    expect(screen.getByText(hint)).toBeVisible();
    for (const button of actionButtons()) expect(button).toHaveAccessibleDescription(hint);

    fireEvent.change(screen.getByLabelText("Nazwa"), { target: { value: "Rowerek" } });
    for (const button of actionButtons()) expect(button).toHaveAccessibleDescription(hint);

    await chooseStrollers();
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
    for (const button of actionButtons()) {
      expect(button).not.toHaveAttribute("aria-disabled");
      expect(button).not.toHaveAttribute("aria-describedby");
    }
  });

  it.each([
    ["Oddam", "GIFT"],
    ["Zamienię", "SWAP"],
    ["Wersja robocza", null],
  ] as const)("%s registers the item with listing_mode %s, then uploads the photos", async (label, mode) => {
    const photo = new File(["a"], "a.jpg", { type: "image/jpeg" });
    vi.mocked(productsApi.addProductPhoto).mockResolvedValue(
      {} as Awaited<ReturnType<typeof productsApi.addProductPhoto>>,
    );
    await fillForm("  Rowerek  ");
    fireEvent.change(screen.getByLabelText("Stan"), { target: { value: "LIKE_NEW" } });
    addPhoto(photo);

    fireEvent.click(screen.getByRole("button", { name: label }));

    expect(await screen.findByText(`ITEM PAGE ${NEW_ITEM_ID}`)).toBeInTheDocument();
    expect(productsApi.resolveProduct).toHaveBeenCalledWith({ name: "Rowerek", category_id: CAT_STROLLERS });
    expect(inventoriesApi.registerInventoryItem).toHaveBeenCalledWith({
      inventory_id: INVENTORY_ID,
      product_id: PRODUCT_ID,
      condition: "LIKE_NEW",
      listing_mode: mode,
    });
    expect(vi.mocked(productsApi.addProductPhoto).mock.calls).toEqual([[PRODUCT_ID, photo]]);
    const registerOrder = vi.mocked(inventoriesApi.registerInventoryItem).mock.invocationCallOrder[0];
    expect(registerOrder).toBeLessThan(vi.mocked(productsApi.addProductPhoto).mock.invocationCallOrder[0]);
  });

  it("orders the page Zdjęcia, Nazwa, Stan, Kategoria, Opis and saves the description to the product", async () => {
    vi.mocked(productsApi.updateProductDescription).mockResolvedValue(
      {} as Awaited<ReturnType<typeof productsApi.updateProductDescription>>,
    );
    await fillForm();

    const fields = [
      screen.getByLabelText("Dodaj zdjęcia"),
      screen.getByLabelText("Nazwa"),
      screen.getByLabelText("Stan"),
      categoryTrigger(),
      screen.getByLabelText("Opis"),
    ];
    for (const [before, after] of fields.slice(0, -1).map((field, i) => [field, fields[i + 1]])) {
      expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    fireEvent.change(screen.getByLabelText("Opis"), { target: { value: "  Mało używany  " } });
    fireEvent.click(screen.getByRole("button", { name: "Wersja robocza" }));

    expect(await screen.findByText(`ITEM PAGE ${NEW_ITEM_ID}`)).toBeInTheDocument();
    expect(productsApi.updateProductDescription).toHaveBeenCalledWith(PRODUCT_ID, "Mało używany");
  });

  it("skips an empty description", async () => {
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Wersja robocza" }));
    expect(await screen.findByText(`ITEM PAGE ${NEW_ITEM_ID}`)).toBeInTheDocument();
    expect(productsApi.updateProductDescription).not.toHaveBeenCalled();
  });

  it("still opens the new item when the description is refused, with a notice", async () => {
    vi.mocked(productsApi.updateProductDescription).mockRejectedValue(new ApiError(500, "Internal Server Error", {}));
    await fillForm();
    fireEvent.change(screen.getByLabelText("Opis"), { target: { value: "Opis" } });
    fireEvent.click(screen.getByRole("button", { name: "Wersja robocza" }));

    expect(await screen.findByText(`ITEM PAGE ${NEW_ITEM_ID}`)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("nie udało się zapisać opisu");
  });

  it("an empty gallery is one big add tile; a photo shows a tile with Usuń and the main add button", async () => {
    renderPage();
    await act(async () => {});
    expect(screen.queryByRole("button", { name: /^Usuń zdjęcie/ })).not.toBeInTheDocument();

    addPhoto(new File(["a"], "a.jpg", { type: "image/jpeg" }));
    expect(screen.getByText("+ Dodaj zdjęcia")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Usuń zdjęcie 1" }));
    expect(screen.queryByRole("button", { name: "Usuń zdjęcie 1" })).not.toBeInTheDocument();
    expect(screen.queryByText("+ Dodaj zdjęcia")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Dodaj zdjęcia")).toBeEnabled();
  });

  it("shows the gift-limit 409 verbatim and keeps the form data", async () => {
    vi.mocked(inventoriesApi.registerInventoryItem).mockRejectedValue(
      new ApiError(409, "Conflict", { status: 409, error: "Conflict", message: GIFT_LIMIT_MESSAGE }),
    );
    await fillForm();
    fireEvent.change(screen.getByLabelText("Stan"), { target: { value: "NEW" } });
    addPhoto(new File(["a"], "a.jpg", { type: "image/jpeg" }));

    fireEvent.click(screen.getByRole("button", { name: "Oddam" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(GIFT_LIMIT_MESSAGE);
    expect(productsApi.addProductPhoto).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Nazwa")).toHaveValue("Rowerek");
    expect(screen.getByLabelText("Stan")).toHaveValue("NEW");
    expect(categoryTrigger()).toHaveTextContent("Wózki");
    expect(screen.getByRole("button", { name: "Usuń zdjęcie 1" })).toBeInTheDocument();
    for (const button of actionButtons()) expect(button).toBeEnabled();
  });

  it("sends no request when Enter submits the form from the name input", async () => {
    await fillForm();
    const name = screen.getByLabelText("Nazwa");

    fireEvent.keyDown(name, { key: "Enter" });
    fireEvent.submit(name.closest("form")!);

    expect(peopleApi.getMyProfile).not.toHaveBeenCalled();
    expect(inventoriesApi.registerInventoryItem).not.toHaveBeenCalled();
    expect(screen.queryByText(`ITEM PAGE ${NEW_ITEM_ID}`)).not.toBeInTheDocument();
  });

  it("falls back to a Polish message for an unexpected error", async () => {
    vi.mocked(inventoriesApi.registerInventoryItem).mockRejectedValue(new ApiError(500, "Server Error", null));
    await fillForm();

    fireEvent.click(screen.getByRole("button", { name: "Zamienię" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się dodać rzeczy. Spróbuj ponownie.");
  });

  it("still opens the new item when a photo is refused and tells how many failed", async () => {
    vi.mocked(productsApi.addProductPhoto)
      .mockRejectedValueOnce(new ApiError(409, "Conflict", { message: "Duplikat" }))
      .mockResolvedValueOnce({} as Awaited<ReturnType<typeof productsApi.addProductPhoto>>);
    await fillForm();
    addPhoto(new File(["a"], "a.jpg", { type: "image/jpeg" }));
    addPhoto(new File(["b"], "b.png", { type: "image/png" }));

    fireEvent.click(screen.getByRole("button", { name: "Wersja robocza" }));

    expect(await screen.findByText(`ITEM PAGE ${NEW_ITEM_ID}`)).toBeInTheDocument();
    expect(productsApi.addProductPhoto).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent("nie udało się dodać części zdjęć (1)");
  });

  it("rejects an unsupported photo with a message and keeps the list empty", async () => {
    renderPage();
    await act(async () => {});

    addPhoto(new File(["gif"], "a.gif", { type: "image/gif" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Nieobsługiwany plik — dodaj zdjęcie JPG, PNG lub WebP");
    expect(screen.queryByRole("button", { name: "Usuń zdjęcie 1" })).not.toBeInTheDocument();
  });
});
