import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as wantsApi from "../api/wants";
import type { WantMatchResponse, WantResponse, WantSimilarResponse, WantSuggestionResponse } from "../api/wants";
import { WantMatchesView } from "../features/wanted/WantMatchesView";
import { makeWant, makeWantMatch, makeWantSimilar, makeWantSuggestion } from "./fixtures/wants";
import { createQueryWrapper } from "./queryClient";
import { getTestLocation, renderWithRoute } from "./renderWithRoute";

vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: "token-a" }) }));

vi.mock("../api/wants", () => ({
  getMyWants: vi.fn(),
  getWant: vi.fn(),
  getWantMatches: vi.fn(),
  getWantSuggestions: vi.fn(),
  getWantSimilar: vi.fn(),
  updateWant: vi.fn(),
  extendWant: vi.fn(),
  closeWant: vi.fn(),
  resumeWant: vi.fn(),
  markWantMatchesSeen: vi.fn(),
  markWantMatchOpened: vi.fn(),
}));

const TOGGLE_LABEL = "Powiadomienia o nowych rzeczach";

function apiError(status: number, message: string) {
  return new ApiError(status, "Error", { status, error: "Error", message });
}

function serve(
  want: WantResponse,
  matches: WantMatchResponse[] = [],
  suggestions: WantSuggestionResponse[] = [],
  similar: WantSimilarResponse[] = [],
) {
  vi.mocked(wantsApi.getWant).mockResolvedValue(want);
  vi.mocked(wantsApi.getWantMatches).mockResolvedValue(matches);
  vi.mocked(wantsApi.getWantSuggestions).mockResolvedValue(suggestions);
  vi.mocked(wantsApi.getWantSimilar).mockResolvedValue(similar);
}

/** The match grid's placeholder tiles, hidden from assistive technology. */
function skeletonTiles(): Element[] {
  return Array.from(document.querySelectorAll('ul[aria-hidden="true"] > li'));
}

const SUGGESTIONS_HEADING = "Może Cię zainteresuje";
const SIMILAR_HEADING = "Powiązane rzeczy";

function follows(earlier: Node, later: Node): boolean {
  return (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

function renderView() {
  return renderWithRoute(<WantMatchesView />, {
    url: "/wanted/want-1",
    pattern: "/wanted/:id",
    routes: { "/wanted": <p>Lista Szukam</p>, "/:slug/product/:itemId": <p>Strona rzeczy</p> },
    wrapper: createQueryWrapper(),
  });
}

function cardOf(title: string): HTMLElement {
  const card = screen.getByRole("link", { name: title }).closest("article");
  if (!card) throw new Error(`no card for ${title}`);
  return card;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-15T10:00:00Z"));
  vi.mocked(wantsApi.getMyWants).mockResolvedValue([]);
  vi.mocked(wantsApi.getWantSuggestions).mockResolvedValue([]);
  vi.mocked(wantsApi.getWantSimilar).mockResolvedValue([]);
  vi.mocked(wantsApi.markWantMatchesSeen).mockResolvedValue(makeWant());
  vi.mocked(wantsApi.markWantMatchOpened).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WantMatchesView", () => {
  it("shows the header with the full category path, the note, the count and the expiry", async () => {
    serve(
      makeWant({
        category_name: "Pojazdy dla dzieci",
        category_path: "Zabawki › Pojazdy dla dzieci",
        offer_mode: "GIFT",
        locality_name: "Kęty",
        radius_km: 10,
        note: "Dla 3-latka, najlepiej z hamulcem",
      }),
      [makeWantMatch(), makeWantMatch({ id: "item-2", title: "Rowerek drewniany" })],
    );
    renderView();

    expect(await screen.findByRole("heading", { level: 1, name: "Rowerek biegowy" })).toBeInTheDocument();
    expect(screen.getByText("Zabawki › Pojazdy dla dzieci · Oddam · Kęty +10 km")).toBeInTheDocument();
    expect(screen.getByText("Notatka: Dla 3-latka, najlepiej z hamulcem")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "‹ Szukam" })).toHaveAttribute("href", "/wanted");
    expect(screen.getByRole("link", { name: "Edytuj" })).toHaveAttribute("href", "/wanted/want-1/edit");
    expect(screen.getByRole("heading", { level: 2, name: "2 pasujące rzeczy" })).toBeInTheDocument();
    expect(screen.getByText("Ważne jeszcze 90 dni")).toBeInTheDocument();
  });

  it("saves the notification switch at once with that field alone, and reverts a failed change with the server message", async () => {
    serve(makeWant(), [makeWantMatch()]);
    vi.mocked(wantsApi.updateWant).mockImplementation(async () => {
      serve(makeWant({ notifications_enabled: false }), [makeWantMatch()]);
      return makeWant({ notifications_enabled: false });
    });
    renderView();

    const toggle = await screen.findByRole("switch", { name: TOGGLE_LABEL });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toHaveAccessibleDescription("Damy znać w dzwonku");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await waitFor(() => expect(toggle).toHaveAccessibleDescription("Wyłączone"));
    expect(wantsApi.updateWant).toHaveBeenCalledWith("want-1", { notifications_enabled: false });
    await waitFor(() => expect(wantsApi.getWant).toHaveBeenCalledTimes(3));

    vi.mocked(wantsApi.updateWant).mockRejectedValue(apiError(503, "Spróbuj za chwilę."));
    fireEvent.click(toggle);
    expect(await screen.findByRole("alert")).toHaveTextContent("Spróbuj za chwilę.");
    expect(wantsApi.updateWant).toHaveBeenLastCalledWith("want-1", { notifications_enabled: true });
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("marks the matches seen once and keeps the 'nowe' markers after the refetch that follows", async () => {
    serve(makeWant({ match_count: 2, new_match_count: 1 }), [
      makeWantMatch({ is_new: true }),
      makeWantMatch({ id: "item-2", title: "Rowerek drewniany" }),
    ]);
    vi.mocked(wantsApi.markWantMatchesSeen).mockImplementation(async () => {
      serve(makeWant({ match_count: 2 }), [
        makeWantMatch(),
        makeWantMatch({ id: "item-2", title: "Rowerek drewniany" }),
      ]);
      return makeWant({ match_count: 2 });
    });
    const view = renderView();

    await screen.findByRole("link", { name: "Rowerek biegowy Puky" });
    await waitFor(() => expect(wantsApi.getWantMatches).toHaveBeenCalledTimes(2));
    view.rerender(<WantMatchesView />);
    await waitFor(() => expect(wantsApi.getMyWants).toHaveBeenCalledTimes(2));

    expect(wantsApi.markWantMatchesSeen).toHaveBeenCalledTimes(1);
    expect(wantsApi.markWantMatchesSeen).toHaveBeenCalledWith("want-1");
    expect(within(cardOf("Rowerek biegowy Puky")).getByText("nowe")).toBeInTheDocument();
    expect(within(cardOf("Rowerek drewniany")).queryByText("nowe")).not.toBeInTheDocument();
  });

  it("captions reserved cards and reports an opened card without holding the navigation back", async () => {
    serve(makeWant(), [
      makeWantMatch(),
      makeWantMatch({
        id: "item-2",
        title: "Moja rezerwacja",
        meta: { mode: "GIFT", condition: "GOOD", thumb_url: null, reserved: true, reserved_until: null },
        reserved_by_me: true,
        proposed_by_me: true,
      }),
      makeWantMatch({ id: "item-3", title: "Moja propozycja", proposed_by_me: true }),
      makeWantMatch({
        id: "item-4",
        title: "Cudza rezerwacja",
        meta: { mode: "SWAP", condition: "GOOD", thumb_url: null, reserved: true, reserved_until: null },
      }),
    ]);
    vi.mocked(wantsApi.markWantMatchOpened).mockRejectedValue(apiError(404, "Nie ma takiej pary."));
    renderView();

    await screen.findByRole("link", { name: "Rowerek biegowy Puky" });
    expect(within(cardOf("Rowerek biegowy Puky")).queryByText(/Zarezerwowan|propozycja/)).not.toBeInTheDocument();
    expect(within(cardOf("Moja rezerwacja")).getByText("Zarezerwowane przez Ciebie")).toBeInTheDocument();
    expect(within(cardOf("Moja propozycja")).getByText("Twoja propozycja")).toBeInTheDocument();
    expect(within(cardOf("Cudza rezerwacja")).getByText("Zarezerwowane")).toBeInTheDocument();
    expect(within(cardOf("Rowerek biegowy Puky")).getByText("Oddam")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "Moja propozycja" }));

    expect(wantsApi.markWantMatchOpened).toHaveBeenCalledWith("want-1", "item-3");
    expect(await screen.findByText("Strona rzeczy")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports a card opened with a middle-click into a new tab, but not a right-click", async () => {
    serve(makeWant(), [makeWantMatch(), makeWantMatch({ id: "item-3", title: "Moja propozycja" })]);
    vi.mocked(wantsApi.markWantMatchOpened).mockResolvedValue(undefined);
    renderView();

    const link = await screen.findByRole("link", { name: "Moja propozycja" });
    fireEvent(link, new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 2 }));
    expect(wantsApi.markWantMatchOpened).not.toHaveBeenCalled();

    fireEvent(link, new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
    expect(wantsApi.markWantMatchOpened).toHaveBeenCalledWith("want-1", "item-3");
  });

  it("offers closing first, or extending first in the last 7 days, and stays on the fulfilled state after 'Znalezione'", async () => {
    serve(makeWant({ expires_at: "2026-11-21T10:00:00" }));
    const soon = renderView();

    expect(await screen.findByText("Jeszcze nic nie pasuje")).toBeInTheDocument();
    expect(screen.getByText("Damy znać, gdy ktoś doda pasującą rzecz.")).toBeInTheDocument();
    expect(screen.getByText("Ważne jeszcze 6 dni")).toBeInTheDocument();
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Przedłuż o 90 dni",
      "Znalezione",
      "Wycofaj",
    ]);

    vi.mocked(wantsApi.extendWant).mockRejectedValueOnce(apiError(409, "Poszukiwanie nie jest aktywne."));
    fireEvent.click(screen.getByRole("button", { name: "Przedłuż o 90 dni" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Poszukiwanie nie jest aktywne.");

    vi.mocked(wantsApi.extendWant).mockImplementation(async () => {
      serve(makeWant(), [makeWantMatch()]);
      return makeWant();
    });
    fireEvent.click(screen.getByRole("button", { name: "Przedłuż o 90 dni" }));
    expect(await screen.findByText("Ważne jeszcze 90 dni")).toBeInTheDocument();
    expect(wantsApi.extendWant).toHaveBeenCalledWith("want-1");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen
        .getAllByRole("button")
        .map((button) => button.textContent)
        .slice(-3),
    ).toEqual(["Znalezione — zamknij", "Przedłuż", "Wycofaj"]);
    soon.unmount();

    serve(makeWant(), [makeWantMatch()]);
    vi.mocked(wantsApi.closeWant).mockImplementation(async () => {
      const fulfilled = makeWant({ status: "FULFILLED", closed_at: "2026-11-15T10:00:00" });
      serve(fulfilled, [makeWantMatch()]);
      return fulfilled;
    });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Znalezione — zamknij" }));

    expect(await screen.findByText(/^Oznaczone jako znalezione/)).toBeInTheDocument();
    expect(wantsApi.closeWant).toHaveBeenCalledWith("want-1", "FULFILLED");
    expect(getTestLocation().pathname).toBe("/wanted/want-1");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("confirms a withdrawal: an error stays in the open dialog, a success leads to the list", async () => {
    serve(makeWant(), [makeWantMatch()]);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Wycofaj" }));
    const dialog = screen.getByRole("alertdialog", { name: "Wycofać poszukiwanie?" });
    expect(dialog).toHaveAccessibleDescription(
      "„Rowerek biegowy” zniknie z listy razem z dopasowaniami. Nie damy już znać o nowych rzeczach.",
    );
    expect(within(dialog).getByRole("button", { name: "Anuluj" })).toBeInTheDocument();

    vi.mocked(wantsApi.closeWant).mockRejectedValueOnce(apiError(503, "Spróbuj za chwilę."));
    fireEvent.click(within(dialog).getByRole("button", { name: "Wycofaj" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Spróbuj za chwilę.");
    expect(getTestLocation().pathname).toBe("/wanted/want-1");

    vi.mocked(wantsApi.closeWant).mockImplementation(async () => {
      vi.mocked(wantsApi.getWant).mockRejectedValue(apiError(404, "Nie znaleziono poszukiwania."));
      return makeWant({ status: "WITHDRAWN", closed_at: "2026-11-15T10:00:00" });
    });
    const wantFetches = vi.mocked(wantsApi.getWant).mock.calls.length;
    const matchFetches = vi.mocked(wantsApi.getWantMatches).mock.calls.length;
    const listFetches = vi.mocked(wantsApi.getMyWants).mock.calls.length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Wycofaj" }));

    expect(await screen.findByText("Lista Szukam")).toBeInTheDocument();
    expect(wantsApi.closeWant).toHaveBeenLastCalledWith("want-1", "WITHDRAWN");
    expect(screen.queryByText("Nie ma takiego poszukiwania")).not.toBeInTheDocument();
    // The withdrawn want is not fetched again (each refetch was a 404); the list still is.
    await waitFor(() => expect(wantsApi.getMyWants).toHaveBeenCalledTimes(listFetches + 1));
    expect(wantsApi.getWant).toHaveBeenCalledTimes(wantFetches);
    expect(wantsApi.getWantMatches).toHaveBeenCalledTimes(matchFetches);
  });

  it("shows an expired and a fulfilled want with their stored matches, without editing or the switch", async () => {
    serve(makeWant({ status: "EXPIRED", expires_at: "2026-11-12T09:00:00", closed_at: "2026-11-12T09:00:00" }), [
      makeWantMatch(),
    ]);
    const expired = renderView();

    expect(
      await screen.findByText(
        "To poszukiwanie wygasło 3 dni temu. Nie szukamy już nowych rzeczy. Zniknie z listy za 27 dni.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "1 pasująca rzecz" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Rowerek biegowy Puky" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edytuj" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Wznów na 90 dni"]);

    vi.mocked(wantsApi.resumeWant).mockRejectedValue(apiError(409, "Masz już 30 aktywnych poszukiwań."));
    fireEvent.click(screen.getByRole("button", { name: "Wznów na 90 dni" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Masz już 30 aktywnych poszukiwań.");
    expect(wantsApi.resumeWant).toHaveBeenCalledWith("want-1");
    expired.unmount();

    serve(makeWant({ status: "FULFILLED", closed_at: "2026-11-10T09:00:00" }), [makeWantMatch()]);
    renderView();

    expect(
      await screen.findByText(
        "Oznaczone jako znalezione 5 dni temu. Nie szukamy już nowych rzeczy. Zniknie z listy za 25 dni.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edytuj" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Szukam znowu"]);
  });

  it("a card of an Organization's item links to its slug page and shows the thumbnail", async () => {
    serve(makeWant({ match_count: 1 }), [
      makeWantMatch({
        href: "/fundacja-sanki/product/item-1",
        meta: {
          mode: "GIFT",
          condition: "GOOD",
          thumb_url: "https://cdn.test/sanki/w400.webp",
          reserved: false,
          reserved_until: null,
        },
      }),
    ]);
    renderView();

    const link = await screen.findByRole("link", { name: "Rowerek biegowy Puky" });
    expect(link).toHaveAttribute("href", "/fundacja-sanki/product/item-1");
    const thumb = cardOf("Rowerek biegowy Puky").querySelector("img");
    expect(thumb).toHaveAttribute("src", "https://cdn.test/sanki/w400.webp");
  });

  it("a failed 'Znalezione — zamknij' shows the server message by the actions and keeps the want active", async () => {
    serve(makeWant(), [makeWantMatch()]);
    vi.mocked(wantsApi.closeWant).mockRejectedValue(apiError(409, "To poszukiwanie jest już zamknięte."));
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Znalezione — zamknij" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("To poszukiwanie jest już zamknięte.");
    expect(wantsApi.closeWant).toHaveBeenCalledWith("want-1", "FULFILLED");
    expect(screen.getByRole("button", { name: "Znalezione — zamknij" })).toBeInTheDocument();
    expect(screen.queryByText(/^Oznaczone jako znalezione/)).not.toBeInTheDocument();
    expect(getTestLocation().pathname).toBe("/wanted/want-1");
  });

  it("shows its own not-found state for an unknown want, and a retry for another failure", async () => {
    vi.mocked(wantsApi.getWant).mockRejectedValue(apiError(404, "Nie znaleziono poszukiwania."));
    vi.mocked(wantsApi.getWantMatches).mockRejectedValue(apiError(404, "Nie znaleziono poszukiwania."));
    const missing = renderView();

    expect(await screen.findByRole("heading", { name: "Nie ma takiego poszukiwania" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Wróć do listy „Szukam”" })).toHaveAttribute("href", "/wanted");
    expect(wantsApi.markWantMatchesSeen).not.toHaveBeenCalled();
    missing.unmount();

    vi.mocked(wantsApi.getWant).mockRejectedValue(apiError(500, "Błąd serwera."));
    renderView();
    expect(await screen.findByRole("alert")).toHaveTextContent("Błąd serwera.");

    serve(makeWant(), [makeWantMatch()]);
    fireEvent.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Rowerek biegowy" })).toBeInTheDocument();
  });
  it("while matching shows the status row and skeleton tiles, or the stored matches without a skeleton", async () => {
    serve(makeWant({ matching: true }));
    const empty = renderView();

    await screen.findByText("Szukamy pasujących rzeczy…");
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Szukamy pasujących rzeczy…To zwykle kilka sekund.");
    expect(skeletonTiles()).toHaveLength(4);
    expect(screen.queryByText("Jeszcze nic nie pasuje")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edytuj" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: TOGGLE_LABEL })).toBeInTheDocument();
    expect(screen.getByText("Ważne jeszcze 90 dni")).toBeInTheDocument();
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Znalezione — zamknij",
      "Przedłuż",
      "Wycofaj",
    ]);
    empty.unmount();

    serve(makeWant({ matching: true }), [makeWantMatch()]);
    renderView();

    const link = await screen.findByRole("link", { name: "Rowerek biegowy Puky" });
    expect(screen.getByRole("status")).toHaveTextContent("Szukamy pasujących rzeczy…");
    expect(screen.getByRole("status").compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(skeletonTiles()).toHaveLength(0);
  });

  // Documented exception to the Date-only fake-timer rule (as in
  // useWantMatches.test.tsx): the 60 s window end is a `setTimeout`, so this
  // test fakes it and steps it with act(); no `findBy*` or `waitFor`. The
  // Date-only clock from beforeEach is replaced, not extended: a second
  // useFakeTimers call over it leaves setTimeout real.
  it("after 60 s of matching shows the slow card whose „Odśwież teraz” reads the want again", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-11-15T10:00:00Z"));
    serve(makeWant({ matching: true }));
    renderView();
    await act(async () => {});
    expect(screen.getByText("Szukamy pasujących rzeczy…")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(60_000));

    const card = screen.getByRole("status");
    expect(card).toHaveAttribute("aria-live", "polite");
    expect(within(card).getByRole("heading", { name: "Wyniki pojawią się wkrótce" })).toBeInTheDocument();
    expect(card).toHaveTextContent(
      "Szukanie trwa dłużej niż zwykle. Zajrzyj tu za chwilę — damy też znać o nowych rzeczach.",
    );
    expect(skeletonTiles()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Wycofaj" })).toBeInTheDocument();

    const fetches = vi.mocked(wantsApi.getWant).mock.calls.length;
    serve(makeWant(), [makeWantMatch()]);
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: "Odśwież teraz" }));
    });
    expect(wantsApi.getWant).toHaveBeenCalledTimes(fetches + 1);
    expect(screen.getByRole("link", { name: "Rowerek biegowy Puky" })).toBeInTheDocument();
    expect(screen.queryByText("Wyniki pojawią się wkrótce")).not.toBeInTheDocument();
  });

  it("shows suggestions under the empty card with the missing words, and reports an opened suggestion", async () => {
    serve(makeWant({ name: "Traktor Bruder Claas" }), [], [
      makeWantSuggestion(),
      makeWantSuggestion({ id: "item-8", title: "Traktor Fendt", missing_words: ["Bruder", "Claas"] }),
    ]);
    renderView();

    const section = await screen.findByRole("region", { name: SUGGESTIONS_HEADING });
    const heading = within(section).getByRole("heading", { level: 2, name: SUGGESTIONS_HEADING });
    expect(heading.querySelector('[aria-hidden="true"]')).toHaveTextContent("💡");
    expect(within(section).getByText("Podobne rzeczy — brakuje im jednego słowa z Twojego „Szukam”.")).toBeInTheDocument();
    const emptyCard = screen.getByRole("heading", { name: "Jeszcze nic nie pasuje" });
    expect(emptyCard.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const card = cardOf("Traktor bruder Deutz");
    expect(within(card).getByText(/^brakuje:/)).toHaveTextContent("brakuje: „Claas”");
    expect(within(card).queryByText("nowe")).not.toBeInTheDocument();
    expect(card).toHaveClass("border-dashed");
    expect(within(cardOf("Traktor Fendt")).getByText(/^brakuje:/)).toHaveTextContent("brakuje: „Bruder”, „Claas”");

    fireEvent.click(screen.getByRole("link", { name: "Traktor bruder Deutz" }));
    expect(wantsApi.markWantMatchOpened).toHaveBeenCalledWith("want-1", "item-7");
  });

  it("with matches and no suggestions renders the count and the grid without a suggestions section", async () => {
    serve(makeWant(), [makeWantMatch({ is_new: true }), makeWantMatch({ id: "item-2", title: "Rowerek drewniany" })]);
    renderView();

    expect(await screen.findByRole("heading", { level: 2, name: "2 pasujące rzeczy" })).toBeInTheDocument();
    expect(within(cardOf("Rowerek biegowy Puky")).getByText("nowe")).toBeInTheDocument();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.queryByText(SUGGESTIONS_HEADING)).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows „Powiązane rzeczy” after the suggestions and before the actions of an active want", async () => {
    serve(makeWant(), [makeWantMatch()], [makeWantSuggestion()], [makeWantSimilar()]);
    renderView();

    const section = await screen.findByRole("region", { name: SIMILAR_HEADING });
    const heading = within(section).getByRole("heading", { level: 2, name: SIMILAR_HEADING });
    expect(heading.querySelector('[aria-hidden="true"]')).toHaveTextContent("🔗");
    expect(within(section).getByText("Rzeczy o podobnym znaczeniu — mogą Ci się przydać.")).toBeInTheDocument();
    expect(within(section).getByRole("list")).toHaveClass("grid", "grid-cols-2", "gap-3", "sm:grid-cols-3");
    const matchCount = screen.getByRole("heading", { level: 2, name: "1 pasująca rzecz" });
    const suggestions = screen.getByRole("region", { name: SUGGESTIONS_HEADING });
    expect(follows(matchCount, suggestions)).toBe(true);
    expect(follows(suggestions, section)).toBe(true);
    expect(follows(section, screen.getByText("Ważne jeszcze 90 dni"))).toBe(true);
  });

  it("keeps the empty card before „Powiązane rzeczy”, and while matching puts them after the skeleton or the matches", async () => {
    serve(makeWant(), [], [], [makeWantSimilar()]);
    const empty = renderView();

    const section = await screen.findByRole("region", { name: SIMILAR_HEADING });
    expect(follows(screen.getByRole("heading", { name: "Jeszcze nic nie pasuje" }), section)).toBe(true);
    expect(follows(section, screen.getByText("Ważne jeszcze 90 dni"))).toBe(true);
    empty.unmount();

    serve(makeWant({ matching: true }), [], [], [makeWantSimilar()]);
    const skeleton = renderView();
    const matchingSection = await screen.findByRole("region", { name: SIMILAR_HEADING });
    expect(skeletonTiles()).toHaveLength(4);
    expect(follows(skeletonTiles()[3], matchingSection)).toBe(true);
    expect(screen.queryByText("Jeszcze nic nie pasuje")).not.toBeInTheDocument();
    expect(follows(matchingSection, screen.getByText("Ważne jeszcze 90 dni"))).toBe(true);
    skeleton.unmount();

    serve(makeWant({ matching: true }), [makeWantMatch()], [], [makeWantSimilar()]);
    renderView();
    const withMatches = await screen.findByRole("region", { name: SIMILAR_HEADING });
    expect(follows(screen.getByRole("link", { name: "Rowerek biegowy Puky" }), withMatches)).toBe(true);
  });

  it("has no „Powiązane rzeczy” without related items, nor on an expired or a fulfilled want", async () => {
    serve(makeWant(), [makeWantMatch()]);
    const none = renderView();
    await screen.findByRole("link", { name: "Rowerek biegowy Puky" });
    expect(screen.queryByText(SIMILAR_HEADING)).not.toBeInTheDocument();
    none.unmount();

    for (const closed of [
      makeWant({ status: "EXPIRED", expires_at: "2026-11-12T09:00:00", closed_at: "2026-11-12T09:00:00" }),
      makeWant({ status: "FULFILLED", closed_at: "2026-11-10T09:00:00" }),
    ]) {
      serve(closed, [makeWantMatch()], [], [makeWantSimilar()]);
      const view = renderView();
      await screen.findByRole("link", { name: "Rowerek biegowy Puky" });
      expect(screen.queryByText(SIMILAR_HEADING)).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Hulajnoga trójkołowa" })).not.toBeInTheDocument();
      view.unmount();
    }
  });

  // Fakes setTimeout too, as the slow-card test above, to reach matchingSlow.
  it("has no „Powiązane rzeczy” without related items while empty, matching or matching slowly", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-11-15T10:00:00Z"));
    serve(makeWant(), [], [makeWantSuggestion()]);
    const empty = renderView();
    await act(async () => {});
    expect(screen.getByRole("heading", { name: "Jeszcze nic nie pasuje" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: SUGGESTIONS_HEADING })).toBeInTheDocument();
    expect(screen.queryByText(SIMILAR_HEADING)).not.toBeInTheDocument();
    empty.unmount();

    serve(makeWant({ matching: true }));
    renderView();
    await act(async () => {});
    expect(screen.getByText("Szukamy pasujących rzeczy…")).toBeInTheDocument();
    expect(screen.queryByText(SIMILAR_HEADING)).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByRole("heading", { name: "Wyniki pojawią się wkrótce" })).toBeInTheDocument();
    expect(screen.queryByText(SIMILAR_HEADING)).not.toBeInTheDocument();
    expect(wantsApi.getWantSimilar).toHaveBeenCalledWith("want-1");
  });

  it("a related card is dashed without „brakuje:” or „nowe”, captions a reservation and reports its opening", async () => {
    serve(makeWant(), [], [], [
      makeWantSimilar(),
      makeWantSimilar({
        id: "item-13",
        title: "Autko na pedały",
        meta: { mode: "SWAP", condition: "GOOD", thumb_url: null, reserved: true, reserved_until: null },
      }),
    ]);
    renderView();

    await screen.findByRole("region", { name: SIMILAR_HEADING });
    const card = cardOf("Hulajnoga trójkołowa");
    expect(card).toHaveClass("border-dashed");
    expect(within(card).queryByText(/brakuje:/)).not.toBeInTheDocument();
    expect(within(card).queryByText("nowe")).not.toBeInTheDocument();
    expect(within(card).queryByText(/Zarezerwowan|propozycja/)).not.toBeInTheDocument();
    expect(within(cardOf("Autko na pedały")).getByText("Zarezerwowane")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "Hulajnoga trójkołowa" }));
    expect(wantsApi.markWantMatchOpened).toHaveBeenCalledWith("want-1", "item-12");
  });
});
