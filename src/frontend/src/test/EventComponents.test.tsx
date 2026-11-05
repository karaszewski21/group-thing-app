import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventParticipant, EventParticipantItem, EventResponse } from "../api/events";
import { EventAttendeeList } from "../features/events/components/EventAttendeeList";
import { EventChatRow } from "../features/events/components/EventChatRow";
import { EventFooter } from "../features/events/components/EventFooter";
import { EventWhenCard } from "../features/events/components/EventWhenCard";
import { makeLocality, makeLocationRef } from "./fixtures/locations";
import { renderWithRoute } from "./renderWithRoute";

const EMPTY_COPY =
  "Nikt jeszcze się nie zapisał. Zapisz się jako pierwsza osoba i pokaż, co przyniesiesz do wymiany.";
const NEUTRAL_EMPTY_COPY = "Nikt jeszcze się nie zapisał.";

function renderWithProviders(ui: ReactElement) {
  return renderWithRoute(ui, { url: "/" });
}

function eventFixture(overrides: Partial<EventResponse> = {}): EventResponse {
  return {
    id: "ev-1",
    name: "Piknik wymiany zabawek",
    description: null,
    starts_at: "2026-11-14T11:00:00",
    ends_at: "2026-11-14T15:00:00",
    location: makeLocationRef({
      locality: makeLocality({ name: "Warszawa", gmina: "Warszawa", powiat: "Warszawa", voivodeship: "mazowieckie" }),
      label: "Warszawa — al. Jerzego Waszyngtona, Warszawa",
      formatted_address: "al. Jerzego Waszyngtona, Warszawa",
    }),
    created_at: "",
    updated_at: "",
    author_slug: "zielony-krag",
    ...overrides,
  };
}

function item(id: string, productName: string, mode: EventParticipantItem["mode"]): EventParticipantItem {
  return { item_id: id, product_name: productName, mode, thumb_url: null, added_at: "2026-10-30T09:00:00", reservation: null };
}

function participant(overrides: Partial<EventParticipant> = {}): EventParticipant {
  return {
    party_id: "p-author",
    display_name: "Fundacja Zielony Krąg",
    is_author: true,
    is_me: false,
    items: [],
    items_total: 0,
    ...overrides,
  };
}

describe("EventWhenCard", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T10:00:00"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the start–end range, and only the start time without an end", () => {
    const { rerender } = renderWithProviders(
      <EventWhenCard event={eventFixture()} url="https://app.test/zielony-krag/event/ev-1" onCopyLink={() => {}} />,
    );
    const card = screen.getByRole("region", { name: "Termin wydarzenia" });
    expect(within(card).getByText("Termin wydarzenia")).toBeInTheDocument();
    expect(within(card).getByText("sobota, 14 listopada 2026")).toBeInTheDocument();
    expect(within(card).getByText("godz. 11:00–15:00")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: /Dodaj do kalendarza/ })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Kopiuj link" })).toBeInTheDocument();

    rerender(
      <EventWhenCard
        event={eventFixture({ ends_at: null })}
        url="https://app.test/zielony-krag/event/ev-1"
        onCopyLink={() => {}}
      />,
    );
    expect(screen.getByText("godz. 11:00")).toBeInTheDocument();
  });
});

describe("EventAttendeeList", () => {
  it("puts the author first with Organizator and marks the viewer's row with To Ty", () => {
    renderWithProviders(
      <EventAttendeeList
        canSignUp
        participants={[
          participant(),
          participant({ party_id: "p-kasia", display_name: "Kasia", is_author: false, is_me: true }),
          participant({ party_id: "p-marek", display_name: "Marek", is_author: false }),
        ]}
      />,
    );
    const list = screen.getByRole("region", { name: "Zapisani na wydarzenie" });
    expect(within(list).getByRole("heading", { level: 2, name: "Zapisani i ich rzeczy" })).toBeInTheDocument();
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Fundacja Zielony Krąg")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Organizator")).toBeInTheDocument();
    expect(within(rows[1]).getByText("To Ty")).toBeInTheDocument();
    expect(within(rows[2]).queryByText("To Ty")).not.toBeInTheDocument();
    expect(within(rows[2]).queryByText("Organizator")).not.toBeInTheDocument();
    expect(screen.queryByText(EMPTY_COPY)).not.toBeInTheDocument();
  });

  it("links every item to its product page under the participant's party id, with its intent pill", () => {
    renderWithProviders(
      <EventAttendeeList
        canSignUp
        participants={[participant({ items: [item("it-1", "Pluszowy miś", "GIFT"), item("it-2", "Rowerek", "SWAP")] })]}
      />,
    );
    const gift = screen.getByRole("link", { name: /Pluszowy miś/ });
    expect(gift).toHaveAttribute("href", "/p-author/product/it-1");
    expect(gift).toHaveTextContent("Chcę oddać");
    const swap = screen.getByRole("link", { name: /Rowerek/ });
    expect(swap).toHaveAttribute("href", "/p-author/product/it-2");
    expect(swap).toHaveTextContent("Chcę się zamienić");
  });

  it("shows 3 items, then Pokaż więcej (N) › to the participant's items page, no event query", () => {
    renderWithRoute(
      <EventAttendeeList
        canSignUp
        participants={[
          participant({
            items: [item("it-1", "Miś", "GIFT"), item("it-2", "Rowerek", "SWAP"), item("it-3", "Książeczki", "GIFT")],
            items_total: 5,
          }),
        ]}
      />,
      { url: "/zielony-krag/event/ev-1", pattern: "/:slug/event/:eventId" },
    );
    expect(screen.getAllByRole("link", { name: /Miś|Rowerek|Książeczki/ })).toHaveLength(3);
    expect(screen.getByRole("link", { name: /Rowerek/ })).toHaveAttribute("href", "/p-author/product/it-2");
    const more = screen.getByRole("link", { name: "Pokaż więcej (5)" });
    expect(more).toHaveTextContent("Pokaż więcej (5) ›");
    expect(more).toHaveAttribute("href", "/p-author/items");
    expect(screen.queryByRole("button", { name: /Pokaż wszystkie/ })).not.toBeInTheDocument();
  });

  it("keeps the author row and shows the empty copy when nobody else signed up", () => {
    renderWithProviders(<EventAttendeeList canSignUp participants={[participant()]} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Organizator")).toBeInTheDocument();
    expect(screen.getByText(EMPTY_COPY)).toBeInTheDocument();
  });

  it("shows neutral empty copy without the sign-up nudge when the viewer cannot sign up", () => {
    renderWithProviders(
      <EventAttendeeList canSignUp={false} participants={[participant()]} />,
    );
    expect(screen.getByText(NEUTRAL_EMPTY_COPY)).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_COPY)).not.toBeInTheDocument();
  });
});

describe("EventFooter", () => {
  it("renders the signUp, withdraw and disabled ended variants with their copy", () => {
    const onSignUp = vi.fn();
    const onWithdraw = vi.fn();
    const { rerender } = render(<EventFooter variant="signUp" busy={false} onSignUp={onSignUp} />);
    fireEvent.click(screen.getByRole("button", { name: "＋ Zapisz się na wydarzenie" }));
    expect(onSignUp).toHaveBeenCalledTimes(1);

    rerender(<EventFooter variant="signUp" busy onSignUp={onSignUp} />);
    expect(screen.getByRole("button", { name: "＋ Zapisz się na wydarzenie" })).toBeDisabled();

    rerender(<EventFooter variant="withdraw" busy={false} onWithdraw={onWithdraw} />);
    fireEvent.click(screen.getByRole("button", { name: "Wypisz się" }));
    expect(onWithdraw).toHaveBeenCalledTimes(1);

    rerender(<EventFooter variant="ended" />);
    expect(screen.getByRole("button", { name: "Wydarzenie się zakończyło" })).toBeDisabled();
  });
});

describe("EventChatRow", () => {
  it("opens the chat, is disabled while busy and shows an error inline as an alert", () => {
    const onOpen = vi.fn();
    const { rerender } = render(<EventChatRow onOpen={onOpen} busy={false} error={null} />);
    fireEvent.click(screen.getByRole("button", { name: /Czat wydarzenia/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    rerender(<EventChatRow onOpen={onOpen} busy error={null} />);
    expect(screen.getByRole("button", { name: /Czat wydarzenia/ })).toBeDisabled();

    rerender(<EventChatRow onOpen={onOpen} busy={false} error="Brak dostępu do czatu." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Brak dostępu do czatu.");
    expect(screen.getByRole("button", { name: /Czat wydarzenia/ })).toBeEnabled();
  });
});
