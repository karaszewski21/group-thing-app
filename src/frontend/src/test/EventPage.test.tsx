import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as eventsApi from "../api/events";
import type { EventAttendanceResponse, EventDetailResponse, EventParticipant } from "../api/events";
import { EventAuthorCard } from "../features/events/components/EventAuthorCard";
import { EventPage } from "../features/events/EventPage";
import { Link } from "../routing/navigation";
import { peekNavigationState } from "../routing/navigationState";
import { pageFor } from "./appRoutes";
import { createQueryWrapper } from "./queryClient";
import { renderWithRoute } from "./renderWithRoute";

vi.mock("../api/events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/events")>()),
  getEvent: vi.fn(),
  deleteEvent: vi.fn(),
  signUpForEvent: vi.fn(),
  withdrawFromEvent: vi.fn(),
}));
let mockAuth: { token: string | null };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));
const mockChat = { open: vi.fn(), busy: false, error: null };
vi.mock("../hooks/useOpenAndNavigate", () => ({ useOpenAndNavigate: () => mockChat }));

// jsdom has no navigator.clipboard; call history is wiped by vi.resetAllMocks().
const clipboardWriteText = vi.fn();
Object.assign(navigator, { clipboard: { writeText: clipboardWriteText } });

const EVENT_ID = "ev-1";
const PAGE_PATH = `/zielony-krag/event/${EVENT_ID}`;
const OTHER_EVENT_ID = "ev-2";
const NEUTRAL_EMPTY_COPY = "Nikt jeszcze się nie zapisał.";

const AUTHOR: EventParticipant = {
  party_id: "p-author",
  display_name: "Fundacja Zielony Krąg",
  is_author: true,
  is_me: false,
  items: [{ item_id: "it-1", product_name: "Pluszowy miś", mode: "GIFT", thumb_url: null, added_at: "2026-10-30T09:00:00", reservation: null }],
  items_total: 1,
};
const ME: EventParticipant = {
  party_id: "p-me",
  display_name: "Kasia",
  is_author: false,
  is_me: true,
  items: [],
  items_total: 0,
};

function event(overrides: Partial<EventDetailResponse> = {}): EventDetailResponse {
  return {
    id: EVENT_ID,
    name: "Piknik w parku",
    description: "Kocyki i lemoniada",
    starts_at: "2026-11-02T14:00:00",
    ends_at: "2026-11-02T18:00:00",
    location: null,
    created_at: "",
    updated_at: "",
    author_slug: "zielony-krag",
    banner_url: "https://cdn.test/events/ev-1/b/w1600.webp",
    attendee_count: 0,
    is_author: false,
    author_display_name: "Fundacja Zielony Krąg",
    organization: null,
    participants: [AUTHOR],
    is_attending: false,
    has_ended: false,
    open_reservations: null,
    ...overrides,
  };
}

const GUEST_ATTENDANCE: EventAttendanceResponse = {
  id: "att-1",
  event_id: EVENT_ID,
  user_profile_id: "prof-9",
  attached_to_account: false,
};

function page() {
  return (
    <>
      <EventPage />
      <Link to={`/zielony-krag/event/${OTHER_EVENT_ID}`}>Inne wydarzenie</Link>
    </>
  );
}

function renderPage(state?: { toast: string }) {
  return renderWithRoute(page(), {
    url: PAGE_PATH,
    pattern: "/:slug/event/:eventId",
    routes: { "/meetings": <p>Strona spotkań</p> },
    state,
    wrapper: createQueryWrapper(),
  });
}

/** `a` comes before `b` in document order. */
function expectBefore(a: Element, b: Element) {
  expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  mockAuth = { token: null };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("EventPage", () => {
  it("shows an anonymous visitor the page in order, the empty copy and the sign-up footer, without chat", async () => {
    vi.mocked(eventsApi.getEvent).mockResolvedValue(event());
    renderPage();

    const heading = await screen.findByRole("heading", { name: "Piknik w parku", level: 1 });
    const banner = screen.getByRole("img", { name: "Baner wydarzenia Piknik w parku" });
    const when = screen.getByRole("region", { name: "Termin wydarzenia" });
    const description = screen.getByText("Kocyki i lemoniada");
    const list = screen.getByRole("region", { name: "Zapisani na wydarzenie" });
    const footer = screen.getByRole("button", { name: "＋ Zapisz się na wydarzenie" });
    [heading, banner, when, description, list, footer].reduce((prev, next) => {
      expectBefore(prev, next);
      return next;
    });
    expect(screen.getByText("Wydarzenie")).toBeInTheDocument();
    expect(within(list).getByText("Organizator")).toBeInTheDocument();
    expect(
      screen.getByText("Nikt jeszcze się nie zapisał. Zapisz się jako pierwsza osoba i pokaż, co przyniesiesz do wymiany."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Czat wydarzenia/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Edytuj/ })).not.toBeInTheDocument();
  });

  it("shows each participant's newest items with plain product links and Pokaż więcej to their items page", async () => {
    const bartek: EventParticipant = {
      party_id: "p-bartek",
      display_name: "Bartek K.",
      is_author: false,
      is_me: false,
      items: [
        { item_id: "it-7", product_name: "Kurtka", mode: "GIFT", thumb_url: null, added_at: "2026-10-30T09:00:00", reservation: null },
        { item_id: "it-6", product_name: "Rowerek", mode: "SWAP", thumb_url: null, added_at: "2026-10-28T09:00:00", reservation: null },
        { item_id: "it-5", product_name: "Carcassonne", mode: "GIFT", thumb_url: null, added_at: "2026-10-24T09:00:00", reservation: null },
      ],
      items_total: 12,
    };
    vi.mocked(eventsApi.getEvent).mockResolvedValue(event({ attendee_count: 1, participants: [AUTHOR, bartek] }));
    renderPage();

    const list = await screen.findByRole("region", { name: "Zapisani na wydarzenie" });
    const [authorRow, bartekRow] = within(list).getAllByRole("listitem");
    expect(within(authorRow).getByRole("link", { name: /Pluszowy miś/ })).toHaveAttribute(
      "href",
      "/p-author/product/it-1",
    );
    expect(within(authorRow).queryByRole("link", { name: /Pokaż więcej/ })).not.toBeInTheDocument();
    expect(within(bartekRow).getByRole("link", { name: /Kurtka/ })).toHaveAttribute(
      "href",
      "/p-bartek/product/it-7",
    );
    expect(within(bartekRow).getByRole("link", { name: "Pokaż więcej (12)" })).toHaveAttribute(
      "href",
      "/p-bartek/items",
    );
    expect(within(list).queryByRole("button", { name: /Pokaż wszystkie/ })).not.toBeInTheDocument();
  });

  it("a guest signs up in the sheet, the key is stored and the merge card replaces the footer", async () => {
    vi.mocked(eventsApi.getEvent).mockResolvedValue(event());
    vi.mocked(eventsApi.signUpForEvent).mockResolvedValue(GUEST_ATTENDANCE);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "＋ Zapisz się na wydarzenie" }));
    const sheet = screen.getByRole("dialog", { name: "Zapisz się na wydarzenie" });
    expect(within(sheet).getByText("Piknik w parku · pon. 2 listopada, 14:00")).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "Zaloguj się" })).toHaveAttribute(
      "href",
      `/login?returnTo=${encodeURIComponent(PAGE_PATH)}`,
    );

    const name = within(sheet).getByLabelText("Twoje imię");
    expect(name).toHaveAttribute("maxlength", "255");
    fireEvent.click(within(sheet).getByRole("button", { name: "Zapisz się" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Podaj swoje imię.");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(eventsApi.signUpForEvent).not.toHaveBeenCalled();

    fireEvent.change(name, { target: { value: " Ola " } });
    fireEvent.submit(name);

    expect(await screen.findByText("Zapisano Cię jako gościa ✓")).toBeInTheDocument();
    expect(eventsApi.signUpForEvent).toHaveBeenCalledWith(EVENT_ID, { guest_name: "Ola" });
    expect(localStorage.getItem(`guest_profile_id:event:${EVENT_ID}`)).toContain('"userProfileId":"prof-9"');
    expect(screen.getByText("Załóż konto, żeby pisać na czacie wydarzenia i móc się wypisać.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "＋ Zapisz się na wydarzenie" })).not.toBeInTheDocument();
  });

  it("shows the toast handed over in router state once and clears the state", async () => {
    vi.mocked(eventsApi.getEvent).mockResolvedValue(event());
    renderPage({ toast: "Dodano wydarzenie" });

    expect(await screen.findByRole("status")).toHaveTextContent("Dodano wydarzenie");
    await waitFor(() => expect(peekNavigationState(PAGE_PATH)).toBeNull());
  });

  it("links the header chip to the organization, else to the author's person profile", async () => {
    vi.mocked(eventsApi.getEvent).mockResolvedValueOnce(event());
    const { unmount } = renderPage();
    await screen.findByRole("heading", { name: "Piknik w parku", level: 1 });
    expect(screen.getAllByRole("link", { name: /Fundacja Zielony Krąg/ })[0]).toHaveAttribute("href", "/p-author");
    unmount();

    vi.mocked(eventsApi.getEvent).mockResolvedValueOnce(
      event({
        organization: { name: "Fundacja Zielony Krąg", primary_color: null, accent_color: null, palette_preset: null },
      }),
    );
    renderPage();
    expect(await screen.findByRole("link", { name: /Fundacja Zielony Krąg/ })).toHaveAttribute("href", "/zielony-krag");
  });

  it("an attendee sees the chat row and themself, and withdraws after confirming", async () => {
    mockAuth = { token: "t" };
    vi.mocked(eventsApi.getEvent).mockResolvedValue(
      event({ is_attending: true, attendee_count: 1, participants: [AUTHOR, ME] }),
    );
    vi.mocked(eventsApi.withdrawFromEvent).mockResolvedValue(undefined);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Czat wydarzenia/ }));
    expect(mockChat.open).toHaveBeenCalledWith({ kind: "EVENT", id: EVENT_ID });
    expect(screen.getByText("To Ty")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Wypisz się" }));
    const dialog = screen.getByRole("alertdialog", { name: "Wypisać się z wydarzenia?" });
    expect(dialog).toHaveAccessibleDescription("Znikniesz z listy zapisanych i stracisz dostęp do czatu wydarzenia.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Wypisz się" }));

    await waitFor(() => expect(eventsApi.withdrawFromEvent).toHaveBeenCalledWith(EVENT_ID));
    expect(await screen.findByRole("status")).toHaveTextContent("Wypisano z wydarzenia");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("the author gets the chat row and the author card instead of a footer, and lands on Spotkania after deleting", async () => {
    mockAuth = { token: "t" };
    vi.mocked(eventsApi.getEvent).mockResolvedValue(event({ is_author: true }));
    vi.mocked(eventsApi.deleteEvent).mockResolvedValue(undefined);
    renderPage();

    expect(await screen.findByRole("link", { name: /Edytuj/ })).toHaveAttribute("href", `/events/${EVENT_ID}/edit`);
    expect(screen.getByText("Twoje wydarzenie")).toBeInTheDocument();
    expect(screen.getByText("Możesz je edytować. Usunąć da się dopiero, gdy nikt nie jest zapisany.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Czat wydarzenia/ })).toBeInTheDocument();
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Zapisz się/ })).not.toBeInTheDocument();
    expect(screen.getByText(NEUTRAL_EMPTY_COPY)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Usuń" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Usunąć wydarzenie?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Usuń wydarzenie" }));

    await waitFor(() => expect(eventsApi.deleteEvent).toHaveBeenCalledWith(EVENT_ID));
    expect(await screen.findByText("Strona spotkań")).toBeInTheDocument();
  });

  it("once the event has ended, a visitor gets the disabled ended footer", async () => {
    vi.mocked(eventsApi.getEvent).mockResolvedValue(event({ has_ended: true }));
    renderPage();

    expect(await screen.findByRole("button", { name: "Wydarzenie się zakończyło" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "＋ Zapisz się na wydarzenie" })).not.toBeInTheDocument();
    expect(screen.getByText(NEUTRAL_EMPTY_COPY)).toBeInTheDocument();
  });

  it("a logged-in visitor signs up with one click, without the guest sheet, and gets a toast", async () => {
    mockAuth = { token: "t" };
    vi.mocked(eventsApi.getEvent).mockResolvedValue(event());
    vi.mocked(eventsApi.signUpForEvent).mockResolvedValue({ ...GUEST_ATTENDANCE, attached_to_account: true });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "＋ Zapisz się na wydarzenie" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Zapisano na wydarzenie");
    expect(eventsApi.signUpForEvent).toHaveBeenCalledWith(EVENT_ID, { guest_name: null });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Kopiuj link copies the slug URL of the event and confirms with a toast", async () => {
    vi.mocked(eventsApi.getEvent).mockResolvedValue(event());
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Kopiuj link" }));

    expect(clipboardWriteText).toHaveBeenCalledWith(`${window.location.origin}${PAGE_PATH}`);
    expect(await screen.findByRole("status")).toHaveTextContent("Skopiowano link");
  });

  it("the author's delete is blocked with a count hint while people are signed up", async () => {
    mockAuth = { token: "t" };
    const guest: EventParticipant = {
      party_id: "p-2",
      display_name: "Ola",
      is_author: false,
      is_me: false,
      items: [],
      items_total: 0,
    };
    vi.mocked(eventsApi.getEvent).mockResolvedValue(
      event({
        is_author: true,
        attendee_count: 2,
        participants: [AUTHOR, ME, guest],
        open_reservations: { total: 2, swaps: 0 },
      }),
    );
    renderPage();

    const remove = await screen.findByRole("button", { name: "Usuń" });
    expect(remove).toHaveAttribute("aria-disabled", "true");
    expect(remove).toHaveAccessibleDescription("Nie można usunąć — zapisały się już 2 osoby.");
    fireEvent.click(remove);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(eventsApi.deleteEvent).not.toHaveBeenCalled();
  });

  it("before the start, deleting an event with open reservations warns with the counts and cancels them", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 1, 12, 0));
    mockAuth = { token: "t" };
    vi.mocked(eventsApi.getEvent).mockResolvedValue(
      event({ is_author: true, open_reservations: { total: 3, swaps: 1 } }),
    );
    vi.mocked(eventsApi.deleteEvent).mockResolvedValue(undefined);
    renderPage();

    const remove = await screen.findByRole("button", { name: "Usuń" });
    expect(remove).not.toHaveAttribute("aria-disabled");
    fireEvent.click(remove);
    const dialog = await screen.findByRole("alertdialog", { name: "Usunąć wydarzenie?" });
    expect(dialog).toHaveAccessibleDescription(
      "Na tym wydarzeniu są 3 otwarte rezerwacje (w tym 1 zamiana). Usunięcie je anuluje — rzeczy wrócą do właścicieli, a obie strony dostaną powiadomienie.",
    );
    expect(within(dialog).getByRole("button", { name: "Anuluj" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Usuń i anuluj rezerwacje" }));

    await waitFor(() => expect(eventsApi.deleteEvent).toHaveBeenCalledWith(EVENT_ID));
    expect(await screen.findByText("Strona spotkań")).toBeInTheDocument();
  });

  it("after the start, the author's delete is blocked while reservations are open", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 2, 15, 0));
    mockAuth = { token: "t" };
    vi.mocked(eventsApi.getEvent).mockResolvedValue(
      event({ is_author: true, open_reservations: { total: 1, swaps: 0 } }),
    );
    renderPage();

    const remove = await screen.findByRole("button", { name: "Usuń" });
    expect(remove).toHaveAttribute("aria-disabled", "true");
    expect(remove).toHaveAccessibleDescription(
      "Nie można usunąć — wydarzenie się rozpoczęło i ma otwarte rezerwacje",
    );
    fireEvent.click(remove);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(eventsApi.deleteEvent).not.toHaveBeenCalled();
  });

  it("after a logout the author's data stays read-only until the refetch, without chat or author card", async () => {
    mockAuth = { token: "t" };
    vi.mocked(eventsApi.getEvent).mockResolvedValueOnce(event({ is_author: true }));
    const { rerender } = renderPage();
    expect(await screen.findByRole("link", { name: /Edytuj/ })).toBeInTheDocument();

    vi.mocked(eventsApi.getEvent).mockReturnValueOnce(new Promise<EventDetailResponse>(() => {}));
    mockAuth = { token: null };
    rerender(page());

    await waitFor(() => expect(screen.queryByRole("link", { name: /Edytuj/ })).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Piknik w parku", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Zapisani na wydarzenie" })).toBeInTheDocument();
    expect(screen.queryByText("Twoje wydarzenie")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Czat wydarzenia/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Zapisz się/ })).not.toBeInTheDocument();
    expect(eventsApi.getEvent).toHaveBeenCalledTimes(2);
  });

  it("navigating to another event drops the previous event's guest sign-up and sheet state", async () => {
    vi.mocked(eventsApi.getEvent).mockImplementation(async (id) =>
      id === OTHER_EVENT_ID ? event({ id: OTHER_EVENT_ID, name: "Bazar zimowy" }) : event(),
    );
    vi.mocked(eventsApi.signUpForEvent).mockResolvedValue(GUEST_ATTENDANCE);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "＋ Zapisz się na wydarzenie" }));
    fireEvent.change(screen.getByLabelText("Twoje imię"), { target: { value: "Ola" } });
    fireEvent.submit(screen.getByLabelText("Twoje imię"));
    expect(await screen.findByText("Zapisano Cię jako gościa ✓")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "Inne wydarzenie" }));

    expect(await screen.findByRole("heading", { name: "Bazar zimowy", level: 1 })).toBeInTheDocument();
    expect(screen.queryByText("Zapisano Cię jako gościa ✓")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "＋ Zapisz się na wydarzenie" })).toBeInTheDocument();
  });

  it.each([
    [1, 0, "Na tym wydarzeniu jest 1 otwarta rezerwacja. Usunięcie"],
    [2, 2, "Na tym wydarzeniu są 2 otwarte rezerwacje (w tym 2 zamiany). Usunięcie"],
    [5, 5, "Na tym wydarzeniu jest 5 otwartych rezerwacji (w tym 5 zamian). Usunięcie"],
    [22, 1, "Na tym wydarzeniu są 22 otwarte rezerwacje (w tym 1 zamiana). Usunięcie"],
  ])("the delete warning for %i reservation(s), %i swap(s) agrees in number", (total, swaps, copy) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 1, 12, 0));
    renderWithRoute(
      <EventAuthorCard event={event({ is_author: true, open_reservations: { total, swaps } })} onDelete={vi.fn()} />,
      { url: "/" },
    );
    fireEvent.click(screen.getByRole("button", { name: "Usuń" }));
    expect(screen.getByRole("alertdialog").textContent).toContain(copy);
  });

  it.each([
    [1, "Nie można usunąć — zapisała się już 1 osoba."],
    [2, "Nie można usunąć — zapisały się już 2 osoby."],
    [5, "Nie można usunąć — zapisało się już 5 osób."],
    [12, "Nie można usunąć — zapisało się już 12 osób."],
    [22, "Nie można usunąć — zapisały się już 22 osoby."],
  ])("the blocked-delete hint for %i attendee(s) agrees in number", (count, hint) => {
    renderWithRoute(<EventAuthorCard event={event({ is_author: true, attendee_count: count })} onDelete={vi.fn()} />, {
      url: "/",
    });
    expect(screen.getByRole("button", { name: "Usuń" })).toHaveAccessibleDescription(hint);
  });

  it("is routed only at /:slug/event/:id; the old /events/:id page route is gone but edit stays", () => {
    expect(pageFor(PAGE_PATH)?.pattern).toBe("/:slug/event/:eventId");
    expect(pageFor(`/events/${EVENT_ID}`)).toBeNull();
    expect(pageFor(`/events/${EVENT_ID}/edit`)?.pattern).toBe("/events/:eventId/edit");
  });
});
