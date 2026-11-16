import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as wantsApi from "../api/wants";
import { CloseWantSheet } from "../features/wanted/CloseWantSheet";
import { makeWant } from "./fixtures/wants";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/wants", () => ({ getMyWants: vi.fn(), closeWant: vi.fn() }));

const BIKE = makeWant({ id: "w1", name: "Rowerek biegowy" });
const TODDLER_BIKE = makeWant({ id: "w2", name: "Rower dla 3-latka" });
const HELMET = makeWant({ id: "w3", name: "Kask dziecięcy" });

function renderSheet(wants = [BIKE]) {
  const onClose = vi.fn();
  render(<CloseWantSheet wants={wants} onClose={onClose} />, { wrapper: createQueryWrapper() });
  return { onClose, sheet: screen.getByRole("dialog", { name: "Zamknąć poszukiwanie?" }) };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("CloseWantSheet", () => {
  it("one want: the title, the want's name, both actions and the 30-day hint", () => {
    const { sheet } = renderSheet();

    expect(within(sheet).getByRole("heading", { name: "Znalezione?" })).toBeInTheDocument();
    expect(sheet).toHaveTextContent("Ta rzecz pasuje do Twojego poszukiwania:");
    expect(within(sheet).getByText("„Rowerek biegowy”")).toBeInTheDocument();
    expect(within(sheet).queryByRole("list")).not.toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Zamknij poszukiwanie" })).toHaveAttribute("type", "button");
    expect(within(sheet).getByRole("button", { name: "Szukam dalej" })).toHaveAttribute("type", "button");
    expect(sheet).toHaveTextContent("Zamknięte poszukiwanie możesz wznowić przez 30 dni.");
  });

  it.each([
    [[BIKE, TODDLER_BIKE], "Zamknij oba poszukiwania"],
    [[BIKE, TODDLER_BIKE, HELMET], "Zamknij wszystkie poszukiwania"],
  ])("several wants: the list of names and the plural action", (wants, action) => {
    const { sheet } = renderSheet(wants);

    expect(sheet).toHaveTextContent("Ta rzecz pasuje do Twoich poszukiwań:");
    expect(within(sheet).getAllByRole("listitem").map((li) => li.textContent)).toEqual(
      wants.map((want) => `„${want.name}”`),
    );
    expect(within(sheet).getByRole("button", { name: action })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Szukam dalej" })).toBeInTheDocument();
    expect(sheet).toHaveTextContent("Zamknięte poszukiwania możesz wznowić przez 30 dni.");
  });

  it("Zamknij closes every want as FULFILLED; a failure stays inline, and a retry counts 409 and 404 as done", async () => {
    vi.mocked(wantsApi.closeWant)
      .mockResolvedValueOnce({ ...BIKE, status: "FULFILLED" })
      .mockRejectedValueOnce(new ApiError(503, "Service Unavailable", { message: "Spróbuj za chwilę" }))
      .mockResolvedValueOnce({ ...HELMET, status: "FULFILLED" });
    const { onClose, sheet } = renderSheet([BIKE, TODDLER_BIKE, HELMET]);

    fireEvent.click(within(sheet).getByRole("button", { name: "Zamknij wszystkie poszukiwania" }));

    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Spróbuj za chwilę");
    expect(vi.mocked(wantsApi.closeWant).mock.calls).toEqual([
      ["w1", "FULFILLED"],
      ["w2", "FULFILLED"],
      ["w3", "FULFILLED"],
    ]);
    expect(onClose).not.toHaveBeenCalled();

    vi.mocked(wantsApi.closeWant)
      .mockRejectedValueOnce(new ApiError(409, "Conflict", { message: "Poszukiwanie jest już zamknięte" }))
      .mockResolvedValueOnce({ ...TODDLER_BIKE, status: "FULFILLED" })
      .mockRejectedValueOnce(new ApiError(404, "Not Found", { message: "Nie znaleziono" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Zamknij wszystkie poszukiwania" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(within(sheet).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("Szukam dalej, ✕ and Esc close the sheet without a request", () => {
    const { onClose, sheet } = renderSheet();

    fireEvent.click(within(sheet).getByRole("button", { name: "Szukam dalej" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Zamknij" }));
    fireEvent.keyDown(sheet, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(3);
    expect(wantsApi.closeWant).not.toHaveBeenCalled();
  });
});
