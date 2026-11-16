import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as wantsApi from "../api/wants";
import type { WantResponse } from "../api/wants";
import { WantedListView } from "../features/wanted/WantedListView";
import { makeWant } from "./fixtures/wants";
import { createQueryWrapper } from "./queryClient";
import { renderWithRoute } from "./renderWithRoute";

vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: "token-a" }) }));

vi.mock("../api/wants", () => ({
  getMyWants: vi.fn(),
  createWant: vi.fn(),
  updateWant: vi.fn(),
  extendWant: vi.fn(),
  closeWant: vi.fn(),
  resumeWant: vi.fn(),
}));

const CAP_MESSAGE = "Masz już 30 aktywnych poszukiwań. Zamknij któreś, aby dodać nowe.";

const BIKE = makeWant({
  id: "want-bike",
  name: "Rowerek biegowy",
  category_id: "cat-1",
  category_name: "Pojazdy dla dzieci",
  category_path: "Zabawki › Pojazdy dla dzieci",
  offer_mode: "GIFT",
  locality_id: "0001",
  locality_name: "Kęty",
  radius_km: 10,
  expires_at: "2027-01-28T12:00:00",
  match_count: 5,
  new_match_count: 2,
});
const JACKET = makeWant({
  id: "want-jacket",
  name: "Kurtka zimowa 110",
  category_id: "cat-2",
  category_name: "Kurtki dziecięce",
  category_path: "Dzieci › Kurtki dziecięce",
  expires_at: "2026-11-21T12:00:00",
});
const SEAT = makeWant({
  id: "want-seat",
  name: "Fotelik samochodowy 9–18 kg",
  notifications_enabled: false,
  expires_at: "2027-02-11T12:00:00",
  match_count: 1,
});
const SLED = makeWant({
  id: "want-sled",
  name: "Sanki drewniane",
  status: "EXPIRED",
  expires_at: "2026-11-12T12:00:00",
  closed_at: "2026-11-12T12:00:00",
});
const COT = makeWant({
  id: "want-cot",
  name: "Łóżeczko turystyczne",
  status: "FULFILLED",
  closed_at: "2026-11-03T12:00:00",
});

function capReached(): ApiError {
  return new ApiError(409, "Conflict", { status: 409, error: "Conflict", message: CAP_MESSAGE });
}

function renderList(wants: WantResponse[]) {
  vi.mocked(wantsApi.getMyWants).mockResolvedValue(wants);
  return renderWithRoute(<WantedListView />, { url: "/wanted", wrapper: createQueryWrapper() });
}

async function findCard(name: string): Promise<HTMLElement> {
  const link = await screen.findByRole("link", { name });
  const card = link.closest("li");
  if (!card) throw new Error(`no card for ${name}`);
  return card;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
});

afterEach(() => vi.useRealTimers());

describe("WantedListView", () => {
  it("shows the header with the way back, the add link and the intro, and no inline add field", async () => {
    renderList([BIKE]);

    expect(screen.getByRole("link", { name: "‹ Konto" })).toHaveAttribute("href", "/account");
    expect(screen.getByRole("heading", { level: 1, name: "Szukam" })).toBeInTheDocument();
    expect(
      screen.getByText("Zapisz, czego potrzebujesz. Damy znać, gdy ktoś doda pasującą rzecz."),
    ).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "+ Dodaj" })).toHaveAttribute("href", "/add/wanted");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(wantsApi.getMyWants).toHaveBeenCalledWith();
  });

  it("an active card links to the match list and shows the summary, the new pill, the matches and the expiry", async () => {
    renderList([BIKE]);

    const card = await findCard("Rowerek biegowy");
    expect(within(card).getByRole("link", { name: "Rowerek biegowy" })).toHaveAttribute("href", "/wanted/want-bike");
    expect(within(card).getByRole("heading", { level: 2, name: "Rowerek biegowy" })).toBeInTheDocument();
    expect(within(card).getByText("Pojazdy dla dzieci · Oddam · Kęty +10 km")).toBeInTheDocument();
    expect(within(card).getByText("2 nowe")).toBeInTheDocument();
    expect(within(card).getByText("5 pasujących rzeczy")).toBeInTheDocument();
    expect(within(card).getByText("Ważne jeszcze 74 dni")).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /Przedłuż/ })).not.toBeInTheDocument();
  });

  it("covers the summary variants, a single match and the empty match band", async () => {
    renderList([JACKET, SEAT]);

    const jacket = await findCard("Kurtka zimowa 110");
    expect(within(jacket).getByText("Kurtki dziecięce · cała Polska")).toBeInTheDocument();
    expect(within(jacket).getByText("Jeszcze nic · powiadomimy Cię")).toBeInTheDocument();
    expect(within(jacket).queryByText(/now[aey]/)).not.toBeInTheDocument();

    const seat = await findCard("Fotelik samochodowy 9–18 kg");
    expect(within(seat).getByText("Bez doprecyzowania · powiadomienia wyłączone")).toBeInTheDocument();
    expect(within(seat).getByText("1 pasująca rzecz")).toBeInTheDocument();
    expect(within(seat).getByText("Ważne jeszcze 88 dni")).toBeInTheDocument();
  });

  it("offers Przedłuż when 7 days or fewer remain and extends the want", async () => {
    vi.mocked(wantsApi.extendWant).mockResolvedValue({ ...JACKET, expires_at: "2027-02-13T12:00:00" });
    renderList([JACKET]);

    const card = await findCard("Kurtka zimowa 110");
    expect(within(card).getByText(/Ważne jeszcze 6 dni/)).toBeInTheDocument();
    vi.mocked(wantsApi.getMyWants).mockResolvedValue([{ ...JACKET, expires_at: "2027-02-13T12:00:00" }]);
    fireEvent.click(within(card).getByRole("button", { name: "Przedłuż: Kurtka zimowa 110" }));

    await waitFor(() => expect(wantsApi.extendWant).toHaveBeenCalledWith("want-jacket"));
    expect(await within(card).findByText("Ważne jeszcze 90 dni")).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /Przedłuż/ })).not.toBeInTheDocument();
  });

  it("expired and fulfilled cards show their dates and pills, and resume through their action", async () => {
    vi.mocked(wantsApi.resumeWant).mockResolvedValue({ ...SLED, status: "ACTIVE", closed_at: null });
    renderList([SLED, COT]);

    const sled = await findCard("Sanki drewniane");
    expect(within(sled).getByText("Wygasło 3 dni temu")).toBeInTheDocument();
    expect(within(sled).getByText("Wygasło")).toBeInTheDocument();
    expect(within(sled).getByText("Zniknie z listy za 27 dni")).toBeInTheDocument();

    const cot = await findCard("Łóżeczko turystyczne");
    expect(within(cot).getByText("Znalezione 12 dni temu")).toBeInTheDocument();
    expect(within(cot).getByText("Znalezione")).toBeInTheDocument();
    expect(within(cot).getByText("Zniknie z listy za 18 dni")).toBeInTheDocument();
    expect(within(cot).getByRole("button", { name: "Szukam znowu: Łóżeczko turystyczne" })).toBeInTheDocument();

    fireEvent.click(within(sled).getByRole("button", { name: "Wznów: Sanki drewniane" }));
    await waitFor(() => expect(wantsApi.resumeWant).toHaveBeenCalledWith("want-sled"));
  });

  it("a want closed today reads „dzisiaj”, as on its match page", async () => {
    renderList([
      { ...SLED, closed_at: "2026-11-15T09:00:00" },
      { ...COT, closed_at: "2026-11-14T13:00:00" },
    ]);

    expect(within(await findCard("Sanki drewniane")).getByText("Wygasło dzisiaj")).toBeInTheDocument();
    expect(within(await findCard("Łóżeczko turystyczne")).getByText("Znalezione dzisiaj")).toBeInTheDocument();
  });

  it("shows a 409 on resume verbatim in an inline alert by the action that failed", async () => {
    vi.mocked(wantsApi.resumeWant).mockRejectedValue(capReached());
    renderList([SLED, COT]);

    const cot = await findCard("Łóżeczko turystyczne");
    fireEvent.click(within(cot).getByRole("button", { name: "Szukam znowu: Łóżeczko turystyczne" }));

    expect(await within(cot).findByRole("alert")).toHaveTextContent(CAP_MESSAGE);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(within(cot).getByRole("button", { name: "Szukam znowu: Łóżeczko turystyczne" })).toBeEnabled();
  });

  it("shows the empty state with the one add link", async () => {
    renderList([]);

    expect(await screen.findByText("Czego potrzebujesz?")).toBeInTheDocument();
    expect(screen.getByText("Dodaj rzecz, której szukasz, np. fotelik albo kurtkę na zimę.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+ Dodaj poszukiwanie" })).toHaveAttribute("href", "/add/wanted");
    expect(screen.queryByRole("link", { name: "+ Dodaj" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("shows the load error with a retry that loads the list", async () => {
    vi.mocked(wantsApi.getMyWants).mockRejectedValue(
      new ApiError(500, "Server Error", { status: 500, error: "Server Error", message: "Nie udało się wczytać." }),
    );
    renderWithRoute(<WantedListView />, { url: "/wanted", wrapper: createQueryWrapper() });

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się wczytać.");
    expect(screen.queryByText("Czego potrzebujesz?")).not.toBeInTheDocument();

    vi.mocked(wantsApi.getMyWants).mockResolvedValue([BIKE]);
    fireEvent.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));

    expect(await screen.findByRole("link", { name: "Rowerek biegowy" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
