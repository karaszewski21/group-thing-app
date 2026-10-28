import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import * as notificationsApi from "../api/notifications";
import * as peopleApi from "../api/people";
import * as termItemListingsApi from "../api/termItemListings";
import type { BrowseTermItemListingResponse } from "../api/termItemListings";
import * as reservationsApi from "../api/reservations";
import { ApiError } from "../api/client";
import { PendingActionsHost } from "../components/pending/PendingActionsHost";
import { resetSnoozeStoreForTests, nextLocal0800 } from "../components/pending/snoozeStore";
import { subscribePendingActionResolved } from "../components/pending/pendingActionResolved";
import { derivePendingActions, pendingActionKey } from "../components/pending/pendingActions";
import { ModalSheet } from "../components/shared/ModalSheet";
import { useRegisterOpenSheet } from "../components/shared/openSheets";
import { NOTIFICATIONS_KEY } from "../hooks/useNotifications";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";

vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: "tok", username: "guest" }) }));
vi.mock("../api/notifications", () => ({
  getMyNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));
vi.mock("../api/people", () => ({ getMyProfile: vi.fn() }));
vi.mock("../api/termItemListings", () => ({
  getMyTermItemListings: vi.fn(),
  getMyTakenTermItemListings: vi.fn(),
}));
vi.mock("../api/reservations", () => ({
  getReservation: vi.fn(),
  confirmTransaction: vi.fn(),
}));

const mockProfile = { party_id: "1", account_user_id: "1" } as peopleApi.UserProfileResponse;

function pendingNotif(
  over: Partial<notificationsApi.NotificationResponse> = {},
): notificationsApi.NotificationResponse {
  return {
    id: "1",
    kind: "SWAP_PROPOSED",
    message: '„Marek" proponuje zamianę za: Rowerek',
    link_path: "/ania/group/5/term/3",
    read_at: null,
    created_at: "2026-03-01T10:00:00",
    reservation_id: null,
    ...over,
  };
}

function confirmNotif(over: Partial<notificationsApi.NotificationResponse> = {}) {
  return pendingNotif({
    id: "2",
    kind: "TERM_CONFIRMATION_NEEDED",
    message: "Czy przekazanie „Pucio” doszło do skutku? (śr 15.10, Muzyczne Maluchy)",
    link_path: "/ania/group/5/term/9",
    ...over,
  });
}

function browseListing(over: Partial<BrowseTermItemListingResponse> = {}): BrowseTermItemListingResponse {
  return {
    id: "501",
    term_id: "3",
    item_id: "9",
    lister_party_id: "7",
    offered_types: ["SWAP"],
    resolved_reservation_id: null,
    taken_by_party_id: null,
    product_name: "Rowerek",
    condition: "GOOD",
    lister_display_name: "Ola",
    created_at: "",
    updated_at: "",
    ...over,
  };
}

function reservation(over: Partial<reservationsApi.ReservationResponse> = {}): reservationsApi.ReservationResponse {
  return {
    id: "77",
    item_id: "9",
    reservation_type: "GIFT",
    reserved_by_user_id: "1",
    paired_reservation_id: null,
    reserved_at: "",
    expires_at: null,
    status: "PENDING",
    notes: null,
    ...over,
  };
}

function LocationProbe() {
  return <p data-testid="location">{useLocation().pathname}</p>;
}

function renderHost(extra: ReactNode = null, client = createTestQueryClient()) {
  return render(
    <MemoryRouter initialEntries={["/strona"]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              {extra}
              <PendingActionsHost />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
    { wrapper: createQueryWrapper(client) },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  resetSnoozeStoreForTests();
  vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([]);
  vi.mocked(notificationsApi.markNotificationRead).mockResolvedValue(undefined);
  vi.mocked(peopleApi.getMyProfile).mockResolvedValue(mockProfile);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PendingActionsHost — swap proposal prompt", () => {
  // Accept/reject never happen from this one-at-a-time modal: it could only
  // surface the first of possibly several competing offers. It links to
  // "Moje rzeczy", where every offer against the item is listed together.
  it("'Zobacz w Moje rzeczy' marks it read, navigates to /items and clears the prompt", async () => {
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([pendingNotif()]);
    renderHost();

    const dialog = await screen.findByRole("dialog", { name: "Propozycja zamiany" });
    expect(within(dialog).getByText(/proponuje zamianę/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Akceptuj" })).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Zobacz w Moje rzeczy" }));

    await waitFor(() => expect(notificationsApi.markNotificationRead).toHaveBeenCalledWith("1"));
    expect(screen.getByTestId("location")).toHaveTextContent("/items");
    expect(screen.queryByRole("dialog", { name: "Propozycja zamiany" })).not.toBeInTheDocument();
  });

  it("a proposal_id on the notification changes nothing — still just info and the 'Moje rzeczy' link", async () => {
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([pendingNotif({ proposal_id: "42" })]);
    renderHost();

    const dialog = await screen.findByRole("dialog", { name: "Propozycja zamiany" });
    expect(within(dialog).getByRole("button", { name: "Zobacz w Moje rzeczy" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Odrzuć" })).not.toBeInTheDocument();
  });

  it("read notifications never surface — only the unread TERM_CONFIRMATION_NEEDED one renders", async () => {
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      pendingNotif({ read_at: "2026-03-01T11:00:00" }),
      confirmNotif(),
    ]);
    renderHost();

    expect(await screen.findByRole("dialog", { name: "Potwierdź przekazanie" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Propozycja zamiany" })).not.toBeInTheDocument();
  });
});

describe("PendingActionsHost — snooze", () => {
  it("'Później' on a TERM_CONFIRMATION_NEEDED prompt snoozes it without marking the notification read", async () => {
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      pendingNotif({
        id: "5",
        kind: "TERM_CONFIRMATION_NEEDED",
        message: "Czy przekazanie doszło do skutku?",
        link_path: "/ania/group/5/term/9",
      }),
    ]);
    renderHost();

    const dialog = await screen.findByRole("dialog", { name: "Potwierdź przekazanie" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Później" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Potwierdź przekazanie" })).not.toBeInTheDocument(),
    );
    expect(notificationsApi.markNotificationRead).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("pendingActionSnooze:guest") ?? "{}")).toHaveProperty("n:5");
  });

  it.each([
    ["✕", (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole("button", { name: "Zamknij" }))],
    ["scrim", (dialog: HTMLElement) => fireEvent.click(dialog.parentElement as HTMLElement)],
    ["Esc", (dialog: HTMLElement) => fireEvent.keyDown(dialog, { key: "Escape" })],
  ])("%s snoozes the prompt the same way, without marking it read", async (_label, close) => {
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([confirmNotif()]);
    renderHost();

    close(await screen.findByRole("dialog", { name: "Potwierdź przekazanie" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Potwierdź przekazanie" })).not.toBeInTheDocument(),
    );
    expect(notificationsApi.markNotificationRead).not.toHaveBeenCalled();
  });

  it("the hint says 'jutro' in the evening, is linked to 'Później', and the prompt returns at the next 08:00", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 9, 13, 20, 0));
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([confirmNotif()]);
    renderHost();

    const dialog = await screen.findByRole("dialog", { name: "Potwierdź przekazanie" });
    const hint = within(dialog).getByText("Przypomnimy jutro o 8:00.");
    const later = within(dialog).getByRole("button", { name: "Później" });
    expect(later).toHaveAttribute("aria-describedby", hint.id);
    expect(hint).toHaveClass("text-xs", "text-ink-soft");

    fireEvent.click(later);
    expect(screen.queryByRole("dialog", { name: "Potwierdź przekazanie" })).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync((11 * 60 + 58) * 60_000);
    });
    expect(screen.queryByRole("dialog", { name: "Potwierdź przekazanie" })).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 60_000);
    });
    expect(screen.getByRole("dialog", { name: "Potwierdź przekazanie" })).toBeInTheDocument();
    expect(notificationsApi.markNotificationRead).not.toHaveBeenCalled();
  });

  it("before 08:00 the hint says 'dziś' and the prompt returns at 08:00 the same day (07:59 → 08:00 boundary)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 9, 14, 7, 59));
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([confirmNotif()]);
    renderHost();

    const dialog = await screen.findByRole("dialog", { name: "Potwierdź przekazanie" });
    expect(within(dialog).getByText("Przypomnimy dziś o 8:00.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Później" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.queryByRole("dialog", { name: "Potwierdź przekazanie" })).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    expect(screen.getByRole("dialog", { name: "Potwierdź przekazanie" })).toBeInTheDocument();
  });

  it("nextLocal0800: 07:59 → today 08:00, 08:00 sharp → tomorrow 08:00", () => {
    expect(nextLocal0800(new Date(2026, 9, 14, 7, 59))).toEqual(new Date(2026, 9, 14, 8, 0));
    expect(nextLocal0800(new Date(2026, 9, 14, 8, 0))).toEqual(new Date(2026, 9, 15, 8, 0));
  });

  it("when localStorage throws, the in-memory fallback still keeps the prompt snoozed across a remount", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([confirmNotif()]);
      const { unmount } = renderHost();

      const dialog = await screen.findByRole("dialog", { name: "Potwierdź przekazanie" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Później" }));
      expect(screen.queryByRole("dialog", { name: "Potwierdź przekazanie" })).not.toBeInTheDocument();
      unmount();

      renderHost();
      await waitFor(() => expect(notificationsApi.getMyNotifications).toHaveBeenCalledTimes(2));
      await act(async () => {});
      expect(screen.queryByRole("dialog", { name: "Potwierdź przekazanie" })).not.toBeInTheDocument();
      expect(notificationsApi.markNotificationRead).not.toHaveBeenCalled();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});

describe("PendingActionsHost — titles", () => {
  it("a TERM_CONFIRMATION_NEEDED prompt with a proposal_id is titled 'Potwierdź zamianę' and shows the message verbatim", async () => {
    const message = "Czy zamiana „Kask” ↔ „Rowerek” doszła do skutku? (czw 16.10, Muzyczne Maluchy)";
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      confirmNotif({ proposal_id: "42", message }),
    ]);
    renderHost();

    const dialog = await screen.findByRole("dialog", { name: "Potwierdź zamianę" });
    expect(within(dialog).getByText(message)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Potwierdź" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Nie doszło/ })).not.toBeInTheDocument();
  });

  it("a legacy swap prompt (no ids, old 'potwierdź zamianę' message) is titled 'Potwierdź zamianę'", async () => {
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      confirmNotif({ message: "Termin się odbył — potwierdź zamianę" }),
    ]);
    renderHost();

    expect(await screen.findByRole("dialog", { name: "Potwierdź zamianę" })).toBeInTheDocument();
  });
});

describe("PendingActionsHost — waits for page dialogs", () => {
  function PageSheetHarness() {
    const [open, setOpen] = useState(true);
    return open ? (
      <ModalSheet title="Wzięte!" onClose={() => setOpen(false)}>
        <p>Treść strony</p>
      </ModalSheet>
    ) : null;
  }

  function RegisteredDialogHarness() {
    const [open, setOpen] = useState(true);
    return open ? <RegisteredDialog onClose={() => setOpen(false)} /> : null;
  }

  function RegisteredDialog({ onClose }: { onClose: () => void }) {
    useRegisterOpenSheet(true);
    return (
      <div role="dialog" aria-label="Prośba o dostęp do grupy">
        <button type="button" onClick={onClose}>
          Anuluj
        </button>
      </div>
    );
  }

  it("renders nothing while a krag ModalSheet is open and shows the prompt once it closes", async () => {
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([confirmNotif()]);
    renderHost(<PageSheetHarness />);

    await waitFor(() => expect(notificationsApi.getMyNotifications).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByRole("dialog", { name: "Potwierdź przekazanie" })).not.toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("dialog", { name: "Wzięte!" })).getByRole("button", { name: "Zamknij" }));

    expect(await screen.findByRole("dialog", { name: "Potwierdź przekazanie" })).toBeInTheDocument();
  });

  it("renders nothing while a useRegisterOpenSheet(true) dialog is mounted and resumes after it unmounts", async () => {
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([confirmNotif()]);
    renderHost(<RegisteredDialogHarness />);

    await waitFor(() => expect(notificationsApi.getMyNotifications).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByRole("dialog", { name: "Potwierdź przekazanie" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));

    expect(await screen.findByRole("dialog", { name: "Potwierdź przekazanie" })).toBeInTheDocument();
  });
});

describe("PendingActionsHost — confirm flow", () => {
  it("confirm success awaits invalidateQueries, shows 'Potwierdzono' and emits the resolved signal", async () => {
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([confirmNotif({ reservation_id: "501" })]);
    vi.mocked(reservationsApi.confirmTransaction).mockResolvedValue({
      reservation_id: "501",
      status: "CONFIRMED",
      already_resolved: false,
    });
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const invalidationsAtEmit: number[] = [];
    const unsubscribe = subscribePendingActionResolved(() => invalidationsAtEmit.push(invalidate.mock.calls.length));
    try {
      renderHost(null, client);

      const dialog = await screen.findByRole("dialog", { name: "Potwierdź przekazanie" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Potwierdź" }));

      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Potwierdzono"));
      expect(reservationsApi.confirmTransaction).toHaveBeenCalledWith("501");
      expect(termItemListingsApi.getMyTakenTermItemListings).not.toHaveBeenCalled();
      expect(peopleApi.getMyProfile).not.toHaveBeenCalled();
      expect(invalidate).toHaveBeenCalledWith({ queryKey: NOTIFICATIONS_KEY });
      expect(invalidationsAtEmit).toEqual([1]);
      expect(notificationsApi.markNotificationRead).toHaveBeenCalledWith("2");
      expect(screen.queryByRole("dialog", { name: "Potwierdź przekazanie" })).not.toBeInTheDocument();
    } finally {
      unsubscribe();
    }
  });

  it("confirms via reservation_id even when the notification's link carries no term id", async () => {
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      confirmNotif({ link_path: null, reservation_id: "502" }),
    ]);
    vi.mocked(reservationsApi.confirmTransaction).mockResolvedValue({
      reservation_id: "502",
      status: "CONFIRMED",
      already_resolved: false,
    });
    renderHost();

    fireEvent.click(
      within(await screen.findByRole("dialog", { name: "Potwierdź przekazanie" })).getByRole("button", {
        name: "Potwierdź",
      }),
    );

    await waitFor(() => expect(reservationsApi.confirmTransaction).toHaveBeenCalledWith("502"));
  });

  it("without reservation_id, resolves the taker's reservation via getMyProfile and the term's listings (post-term-end, empty browse)", async () => {
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([confirmNotif()]);
    vi.mocked(termItemListingsApi.getMyTermItemListings).mockResolvedValue([]);
    vi.mocked(termItemListingsApi.getMyTakenTermItemListings).mockResolvedValue([
      browseListing({ id: "9", taken_by_party_id: mockProfile.party_id, resolved_reservation_id: "77" }),
    ]);
    vi.mocked(reservationsApi.getReservation).mockResolvedValue(reservation());
    vi.mocked(reservationsApi.confirmTransaction).mockResolvedValue({
      reservation_id: "77",
      status: "FULFILLED",
      already_resolved: false,
    });
    renderHost();

    fireEvent.click(
      within(await screen.findByRole("dialog", { name: "Potwierdź przekazanie" })).getByRole("button", {
        name: "Potwierdź",
      }),
    );

    await waitFor(() => expect(reservationsApi.confirmTransaction).toHaveBeenCalledWith("77"));
    expect(peopleApi.getMyProfile).toHaveBeenCalled();
    expect(termItemListingsApi.getMyTakenTermItemListings).toHaveBeenCalledWith("9");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Potwierdź przekazanie" })).not.toBeInTheDocument(),
    );
  });

  it("resolves a GIFT reservation id for the owner/lister side directly, post-term-end", async () => {
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([confirmNotif()]);
    vi.mocked(termItemListingsApi.getMyTakenTermItemListings).mockResolvedValue([]);
    vi.mocked(termItemListingsApi.getMyTermItemListings).mockResolvedValue([
      browseListing({ id: "9", lister_party_id: mockProfile.party_id, resolved_reservation_id: "55" }),
    ]);
    vi.mocked(reservationsApi.getReservation).mockResolvedValue(reservation({ id: "55", reserved_by_user_id: "2" }));
    vi.mocked(reservationsApi.confirmTransaction).mockResolvedValue({
      reservation_id: "55",
      status: "FULFILLED",
      already_resolved: false,
    });
    renderHost();

    fireEvent.click(
      within(await screen.findByRole("dialog", { name: "Potwierdź przekazanie" })).getByRole("button", {
        name: "Potwierdź",
      }),
    );

    await waitFor(() => expect(reservationsApi.confirmTransaction).toHaveBeenCalledWith("55"));
  });

  it("still resolves the SWAP paired-leg reservation id for the owner side", async () => {
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([confirmNotif()]);
    vi.mocked(termItemListingsApi.getMyTakenTermItemListings).mockResolvedValue([]);
    vi.mocked(termItemListingsApi.getMyTermItemListings).mockResolvedValue([
      browseListing({ id: "9", lister_party_id: mockProfile.party_id, resolved_reservation_id: "60" }),
    ]);
    vi.mocked(reservationsApi.getReservation).mockImplementation(async (id: string) =>
      id === "60"
        ? reservation({ id: "60", reservation_type: "SWAP", reserved_by_user_id: "2", paired_reservation_id: "61" })
        : reservation({ id: "61", item_id: "12", reservation_type: "SWAP", paired_reservation_id: "60" }),
    );
    vi.mocked(reservationsApi.confirmTransaction).mockResolvedValue({
      reservation_id: "61",
      status: "FULFILLED",
      already_resolved: false,
    });
    renderHost();

    fireEvent.click(
      within(await screen.findByRole("dialog", { name: "Potwierdź przekazanie" })).getByRole("button", {
        name: "Potwierdź",
      }),
    );

    await waitFor(() => expect(reservationsApi.confirmTransaction).toHaveBeenCalledWith("61"));
  });

  it("losing the confirm race (409 already_resolved) shows the distinct already-resolved state, without the snooze hint", async () => {
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([confirmNotif({ reservation_id: "77" })]);
    vi.mocked(reservationsApi.confirmTransaction).mockRejectedValue(
      new ApiError(409, "Conflict", { reservation_id: "77", status: "ALREADY_RESOLVED", already_resolved: true }),
    );
    renderHost();

    const dialog = await screen.findByRole("dialog", { name: "Potwierdź przekazanie" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Potwierdź" }));

    expect(
      await within(dialog).findByText("Transakcja została już rozstrzygnięta przez drugą stronę."),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Potwierdź" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Rozumiem" })).toBeInTheDocument();
    expect(within(dialog).queryByText(/Przypomnimy/)).not.toBeInTheDocument();
  });

  it("treats a null resolved reservation id as already resolved; 'Rozumiem' marks the notification read", async () => {
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([confirmNotif()]);
    vi.mocked(termItemListingsApi.getMyTakenTermItemListings).mockResolvedValue([]);
    vi.mocked(termItemListingsApi.getMyTermItemListings).mockResolvedValue([]);
    renderHost();

    const dialog = await screen.findByRole("dialog", { name: "Potwierdź przekazanie" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Potwierdź" }));

    expect(
      await within(dialog).findByText("Transakcja została już rozstrzygnięta przez drugą stronę."),
    ).toBeInTheDocument();
    expect(reservationsApi.confirmTransaction).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Rozumiem" }));
    await waitFor(() => expect(notificationsApi.markNotificationRead).toHaveBeenCalledWith("2"));
  });
});

describe("derivePendingActions", () => {
  it("derives actions from unread notifications alone, keyed by notification id", () => {
    const actions = derivePendingActions([
      pendingNotif({ id: "1" }),
      confirmNotif({ id: "2" }),
      confirmNotif({ id: "3", read_at: "2026-03-02T10:00:00" }),
    ]);

    expect(derivePendingActions).toHaveLength(1);
    expect(actions.map(pendingActionKey)).toEqual(["n:1", "n:2"]);
  });
});

describe("PendingActionsHost — queue and stored snoozes", () => {
  it("shows one prompt at a time; snoozing the first reveals the next queued prompt", async () => {
    const first = "Czy przekazanie „Pucio” doszło do skutku? (śr 15.10, Muzyczne Maluchy)";
    const second = "Czy przekazanie „Kask” doszło do skutku? (śr 15.10, Muzyczne Maluchy)";
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      confirmNotif({ id: "2", message: first }),
      confirmNotif({ id: "3", message: second }),
    ]);
    renderHost();

    const dialog = await screen.findByRole("dialog", { name: "Potwierdź przekazanie" });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(within(dialog).getByText(first)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Później" }));

    const next = await screen.findByText(second);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(next.closest("[role='dialog']")).not.toBeNull();
    expect(screen.queryByText(first)).not.toBeInTheDocument();
    expect(notificationsApi.markNotificationRead).not.toHaveBeenCalled();
  });

  it("a snooze stored by an earlier page load keeps its prompt hidden; an expired one is pruned and its prompt shows", async () => {
    const hidden = "Czy przekazanie „Pucio” doszło do skutku? (śr 15.10, Muzyczne Maluchy)";
    const expired = "Czy przekazanie „Kask” doszło do skutku? (śr 15.10, Muzyczne Maluchy)";
    localStorage.setItem(
      "pendingActionSnooze:guest",
      JSON.stringify({ "n:2": Date.now() + 60 * 60_000, "n:3": Date.now() - 60_000 }),
    );
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      confirmNotif({ id: "2", message: hidden }),
      confirmNotif({ id: "3", message: expired }),
    ]);
    renderHost();

    const dialog = await screen.findByRole("dialog", { name: "Potwierdź przekazanie" });
    expect(within(dialog).getByText(expired)).toBeInTheDocument();
    expect(screen.queryByText(hidden)).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("pendingActionSnooze:guest") ?? "{}")).toEqual({
      "n:2": expect.any(Number),
    });
  });
});

describe("PendingActionsHost — corrupt stored snoozes", () => {
  it.each([
    ["null", "null"],
    ["an array", JSON.stringify([1, 2])],
    ["a number", "42"],
    ["not JSON", "{oops"],
  ])("a stored value that is %s is ignored and the prompt still shows", async (_label, stored) => {
    localStorage.setItem("pendingActionSnooze:guest", stored);
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([confirmNotif()]);
    renderHost();

    expect(await screen.findByRole("dialog", { name: "Potwierdź przekazanie" })).toBeInTheDocument();
  });

  it("keeps only finite-number expiries from a stored object", async () => {
    const hidden = "Czy przekazanie „Pucio” doszło do skutku? (śr 15.10, Muzyczne Maluchy)";
    const garbage = "Czy przekazanie „Kask” doszło do skutku? (śr 15.10, Muzyczne Maluchy)";
    localStorage.setItem(
      "pendingActionSnooze:guest",
      JSON.stringify({ "n:2": Date.now() + 60 * 60_000, "n:3": "jutro", "n:4": null }),
    );
    vi.mocked(notificationsApi.getMyNotifications).mockResolvedValue([
      confirmNotif({ id: "2", message: hidden }),
      confirmNotif({ id: "3", message: garbage }),
    ]);
    renderHost();

    const dialog = await screen.findByRole("dialog", { name: "Potwierdź przekazanie" });
    expect(within(dialog).getByText(garbage)).toBeInTheDocument();
    expect(screen.queryByText(hidden)).not.toBeInTheDocument();
  });
});
