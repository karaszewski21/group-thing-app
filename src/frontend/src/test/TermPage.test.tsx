import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { TermPage } from "../pages/krag/TermPage";
import * as groupsApi from "../api/groups";
import * as pledgesApi from "../api/pledges";
import * as termItemListingsApi from "../api/termItemListings";
import { ApiError } from "../api/client";
import type { GroupAccessResponse, JoinRequestResponse, PublicCircleResponse } from "../api/groups";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/groups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/groups")>();
  return {
    ...actual,
    getGroupAccess: vi.fn(),
    createRsvp: vi.fn(),
    mergeAnonymousProfile: vi.fn(),
    createJoinRequest: vi.fn(),
    withdrawJoinRequest: vi.fn(),
  };
});
vi.mock("../api/pledges", () => ({ createPledge: vi.fn() }));
vi.mock("../api/termItemListings", () => ({ takeTermItemListing: vi.fn(), proposeSwap: vi.fn() }));

let mockAuth: { token: string | null; displayName: string | null };

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ ...mockAuth, applyExternalToken: vi.fn() }),
}));

const PATH = "/zajecia/grupa/7/term/101";
const GUEST_KEY = groupsApi.guestProfileIdKey(7, 101);

const circle: PublicCircleResponse = {
  id: 7,
  name: "Muzyczne Skrzaty",
  organizer_display_name: "Ania Kowalska",
  organizer_slug: "ania",
  visibility: "PUBLIC",
  layout_mode: "CIRCLE",
  term: {
    id: 101,
    occurs_on: "2026-10-01T17:00:00",
    description: "Zajęcia w parku",
    needed_items: [
      {
        id: 11,
        product_id: 1,
        product_name: "Bębenek",
        product_category_id: 5,
        product_category_name: "Inne",
        description: null,
        claimed: false,
        claimed_by_name: null,
        claimed_by_party_id: null,
      },
    ],
    item_listings: [
      {
        id: 9,
        item_id: 9,
        product_name: "Rowerek",
        condition: "GOOD",
        offered_types: ["LEND"],
        lister_party_id: 21,
        lister_display_name: "Ola Nowak",
      },
      {
        id: 10,
        item_id: 10,
        product_name: "Namiot",
        condition: "GOOD",
        offered_types: ["GIFT"],
        lister_party_id: 99,
        lister_display_name: "Ania Kowalska",
      },
    ],
  },
  guardians: [
    { party_id: 21, display_name: "Ola Nowak" },
    { party_id: 22, display_name: "Piotr Zieliński" },
  ],
};

function access(
  overrides: { group?: Partial<PublicCircleResponse>; access?: Partial<GroupAccessResponse["access"]> } = {},
): GroupAccessResponse {
  return {
    group: { ...circle, ...overrides.group },
    access: {
      is_member: false,
      is_organizer: false,
      can_view_content: true,
      is_attending: false,
      join_request: null,
      ...overrides.access,
    },
  };
}

function page() {
  return (
    <MemoryRouter initialEntries={[PATH]}>
      <Routes>
        <Route path="/:organizationSlug/grupa/:groupId/term/:termId" element={<TermPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderPage() {
  return render(page(), { wrapper: createQueryWrapper() });
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  mockAuth = { token: null, displayName: null };
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(access());
});

describe("TermPage — header and content", () => {
  it("shows the group name with the term description as the header subtitle", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "Muzyczne Skrzaty" })).toBeInTheDocument();
    expect(screen.getByText("Zajęcia w parku")).toBeInTheDocument();
    expect(groupsApi.getGroupAccess).toHaveBeenCalledWith(7, 101);
  });

  it("renders no subtitle when the term has no description", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(
      access({ group: { term: { ...circle.term!, description: null } } }),
    );
    const { container } = renderPage();

    await screen.findByRole("heading", { level: 1, name: "Muzyczne Skrzaty" });
    expect(container.querySelector(".kg-head-sub")).toBeNull();
  });

  it("draws signed-up people in the group's layout, with the shares/brings markers", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(
      access({
        group: {
          layout_mode: "TABLE",
          term: {
            ...circle.term!,
            needed_items: [{ ...circle.term!.needed_items[0], claimed: true, claimed_by_party_id: 22 }],
          },
        },
      }),
    );
    renderPage();

    expect(await screen.findByTestId("table-chips")).toBeInTheDocument();
    const ola = screen.getByRole("button", { name: "Ola Nowak" });
    const piotr = screen.getByRole("button", { name: "Piotr Zieliński" });
    expect(within(ola).getByLabelText("Udostępnia rzecz")).toBeInTheDocument();
    expect(within(piotr).getByLabelText("Przynosi na zajęcia")).toBeInTheDocument();
    // the organizer offers an item but isn't signed up — listed, not drawn.
    expect(screen.queryByRole("button", { name: "Ania Kowalska" })).not.toBeInTheDocument();
  });

  it("clicking an avatar scrolls to and focuses that person's entry in the list", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Ola Nowak" }));

    const entry = document.getElementById("attendee-21")!;
    expect(entry.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(entry).toHaveFocus();
    expect(entry).toHaveClass("is-on");
  });

  it("lists every attendee with their own offered items, plus non-attending listers", async () => {
    renderPage();

    const list = await screen.findByRole("region", { name: "Zapisani na zajęcia" });
    const ola = document.getElementById("attendee-21")!;
    expect(within(ola).getByText("Rowerek")).toBeInTheDocument();
    expect(within(ola).getByRole("button", { name: "Pożycz: Rowerek" })).toBeInTheDocument();
    expect(within(document.getElementById("attendee-22")!).queryAllByRole("button")).toHaveLength(0);
    expect(within(list).getByText("Ania Kowalska")).toBeInTheDocument();
    expect(within(document.getElementById("attendee-99")!).getByText("Namiot")).toBeInTheDocument();
  });
});

describe("TermPage — sign-up footer", () => {
  it("anonymous: 'Zaloguj się, żeby się zapisać' opens the login / guest choice", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Zaloguj się, żeby się zapisać" }));

    const sheet = screen.getByRole("dialog", { name: "Zapisz się na zajęcia" });
    expect(within(sheet).getByRole("link", { name: "Zaloguj się" })).toHaveAttribute(
      "href",
      `/login?returnTo=${encodeURIComponent(PATH)}`,
    );
    fireEvent.click(within(sheet).getByRole("button", { name: "Zapisz się jako gość" }));
    expect(await screen.findByLabelText("Imię")).toBeInTheDocument();
  });

  it("logged in, not attending: 'Zapisz się na zajęcia' opens the logged-in RSVP dialog", async () => {
    mockAuth = { token: "tok", displayName: "Ala" };
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "＋ Zapisz się na zajęcia" }));

    expect(screen.getByRole("dialog", { name: "Zapisz się na zajęcia" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Imię")).not.toBeInTheDocument();
  });

  it("logged in and attending: no sign-up button", async () => {
    mockAuth = { token: "tok", displayName: "Ala" };
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(access({ access: { is_attending: true } }));
    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Muzyczne Skrzaty" });
    expect(screen.queryByRole("button", { name: /Zapisz się/ })).not.toBeInTheDocument();
  });

  it("a guest who already RSVP'd sees no sign-up button and gets the account form instead of the gate", async () => {
    groupsApi.writeGuestProfile(GUEST_KEY, 55);
    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Muzyczne Skrzaty" });
    expect(screen.queryByRole("button", { name: /Zapisz się|żeby się zapisać/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ja to przyniosę: Bębenek" }));

    expect(screen.getByRole("form", { name: /Załóż konto/ })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("TermPage — item actions", () => {
  it("anonymous 'Ja to przyniosę' opens the account gate and never pledges", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Ja to przyniosę: Bębenek" }));

    expect(screen.getByRole("dialog", { name: "Załóż konto, aby przynieść rzecz" })).toBeInTheDocument();
    expect(pledgesApi.createPledge).not.toHaveBeenCalled();
  });

  it("logged in 'Ja to przyniosę' pledges and shows 'Przynosi: Ty'", async () => {
    mockAuth = { token: "tok", displayName: "Ala" };
    vi.mocked(pledgesApi.createPledge).mockResolvedValue({} as never);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Ja to przyniosę: Bębenek" }));

    await waitFor(() => expect(pledgesApi.createPledge).toHaveBeenCalledWith(11));
    expect(await screen.findByText("Przynosi: Ty")).toBeInTheDocument();
  });

  it("logged in 'Pożycz' takes the item for the shown term", async () => {
    mockAuth = { token: "tok", displayName: "Ala" };
    vi.mocked(termItemListingsApi.takeTermItemListing).mockResolvedValue({} as never);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Pożycz: Rowerek" }));

    await waitFor(() =>
      expect(termItemListingsApi.takeTermItemListing).toHaveBeenCalledWith(9, {
        term_id: 101,
        reservation_type: "LEND",
      }),
    );
  });
});

function privateAccess(
  overrides: { group?: Partial<PublicCircleResponse>; access?: Partial<GroupAccessResponse["access"]> } = {},
): GroupAccessResponse {
  return access({
    group: { visibility: "PRIVATE", term: null, guardians: [], ...overrides.group },
    access: { can_view_content: false, ...overrides.access },
  });
}

const pendingAccess = privateAccess({ access: { join_request: { id: 5, status: "PENDING" } } });

describe("TermPage — access", () => {
  it("anonymous on a PRIVATE group sees only the gate with login links, no term content", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(privateAccess());
    renderPage();

    expect(await screen.findByRole("heading", { level: 2, name: /Ta grupa jest prywatna/ })).toBeInTheDocument();
    expect(screen.getByText(/Zaloguj się, aby poprosić organizatora o dostęp\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zaloguj się" })).toHaveAttribute(
      "href",
      `/login?returnTo=${encodeURIComponent(PATH)}`,
    );
    expect(screen.queryByRole("region", { name: "Zapisani na zajęcia" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Poproś o dostęp" })).not.toBeInTheDocument();
  });

  it("an unknown group or term shows 'Nie znaleziono'", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockRejectedValue(new Error("404"));
    renderPage();

    expect(await screen.findByText("Nie znaleziono")).toBeInTheDocument();
  });

  it("navigating to another term whose fetch fails shows 'Nie znaleziono', not the previous term", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValueOnce(access()).mockRejectedValueOnce(new Error("404"));
    render(
      <MemoryRouter initialEntries={[PATH]}>
        <Link to="/zajecia/grupa/7/term/202">Następne zajęcia</Link>
        <Routes>
          <Route path="/:organizationSlug/grupa/:groupId/term/:termId" element={<TermPage />} />
        </Routes>
      </MemoryRouter>, { wrapper: createQueryWrapper() },
    );
    expect(await screen.findByText("Zajęcia w parku")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "Następne zajęcia" }));

    expect(await screen.findByText("Nie znaleziono")).toBeInTheDocument();
    expect(screen.queryByText("Zajęcia w parku")).not.toBeInTheDocument();
    expect(groupsApi.getGroupAccess).toHaveBeenLastCalledWith(7, 202);
  });
});

describe("TermPage — private group gate", () => {
  beforeEach(() => {
    mockAuth = { token: "tok", displayName: "Ala" };
  });

  it("canRequest: 'Poproś o dostęp' → 'Wyślij' sends the request and shows the pending status", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValueOnce(privateAccess()).mockResolvedValueOnce(pendingAccess);
    vi.mocked(groupsApi.createJoinRequest).mockResolvedValue({ id: 5 } as JoinRequestResponse);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Poproś o dostęp" }));
    const dialog = screen.getByRole("dialog", { name: "Poprosić o dostęp?" });
    expect(within(dialog).getByRole("button", { name: "Wyślij" })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button", { name: "Wyślij" }));

    await waitFor(() => expect(groupsApi.createJoinRequest).toHaveBeenCalledWith(7, 101));
    expect(await within(screen.getByRole("status")).findByText(/Prośba wysłana/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /Ta grupa jest prywatna/ })).toHaveFocus();
  });

  it("Tab and Shift+Tab stay inside the request dialog", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(privateAccess());
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Poproś o dostęp" }));
    const dialog = screen.getByRole("dialog", { name: "Poprosić o dostęp?" });
    const close = within(dialog).getByRole("button", { name: "Zamknij" });
    const cancel = within(dialog).getByRole("button", { name: "Anuluj" });

    cancel.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(cancel).toHaveFocus();
  });

  it("a failed withdraw alert does not come back after the gate moves on and returns to pending", async () => {
    vi.mocked(groupsApi.getGroupAccess)
      .mockResolvedValueOnce(pendingAccess)
      .mockResolvedValueOnce(privateAccess({ access: { join_request: { id: 5, status: "REJECTED" } } }))
      .mockResolvedValueOnce(privateAccess({ access: { join_request: { id: 6, status: "PENDING" } } }));
    vi.mocked(groupsApi.withdrawJoinRequest).mockRejectedValue(new ApiError(500, "Server Error", null));
    vi.mocked(groupsApi.createJoinRequest).mockResolvedValue({ id: 6 } as JoinRequestResponse);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Wycofaj prośbę" }));
    expect(await screen.findByText(/Nie udało się wycofać prośby/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sprawdź ponownie" }));
    fireEvent.click(await screen.findByRole("button", { name: "Poproś ponownie" }));
    fireEvent.click(screen.getByRole("button", { name: "Wyślij" }));

    expect(await screen.findByRole("button", { name: "Wycofaj prośbę" })).toBeInTheDocument();
    expect(screen.queryByText(/Nie udało się wycofać prośby/)).not.toBeInTheDocument();
  });

  it("pending: 'Wycofaj prośbę' withdraws and returns to canRequest", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValueOnce(pendingAccess).mockResolvedValueOnce(privateAccess());
    vi.mocked(groupsApi.withdrawJoinRequest).mockResolvedValue({ id: 5 } as JoinRequestResponse);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Wycofaj prośbę" }));

    await waitFor(() => expect(groupsApi.withdrawJoinRequest).toHaveBeenCalledWith(7, 5));
    expect(await screen.findByRole("button", { name: "Poproś o dostęp" })).toBeInTheDocument();
  });

  it("rejected: offers 'Poproś ponownie'", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(
      privateAccess({ access: { join_request: { id: 5, status: "REJECTED" } } }),
    );
    renderPage();

    expect(await screen.findByText(/nie zatwierdził tym razem Twojej prośby/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Poproś ponownie" })).toBeInTheDocument();
  });

  it("a 409 on create refetches and shows the no-organizer line from the fresh data", async () => {
    vi.mocked(groupsApi.getGroupAccess)
      .mockResolvedValueOnce(privateAccess())
      .mockResolvedValueOnce(privateAccess({ group: { organizer_display_name: null } }));
    vi.mocked(groupsApi.createJoinRequest).mockRejectedValue(new ApiError(409, "Conflict", null));
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Poproś o dostęp" }));
    fireEvent.click(screen.getByRole("button", { name: "Wyślij" }));

    expect(
      await screen.findByText("Ta grupa nie ma teraz organizatora — nie można wysłać prośby."),
    ).toBeInTheDocument();
    expect(groupsApi.getGroupAccess).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /Ta grupa jest prywatna/ })).toHaveFocus();
  });

  it("Esc closes the request dialog and returns focus to 'Poproś o dostęp'; an overlay click closes it too", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(privateAccess());
    renderPage();
    const trigger = await screen.findByRole("button", { name: "Poproś o dostęp" });

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("dialog", { name: "Poprosić o dostęp?" }).parentElement!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(groupsApi.createJoinRequest).not.toHaveBeenCalled();
  });

  it("a non-409 create error keeps the dialog open with an alert and does not refetch", async () => {
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(privateAccess());
    vi.mocked(groupsApi.createJoinRequest).mockRejectedValue(new ApiError(500, "Server Error", null));
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Poproś o dostęp" }));
    const dialog = screen.getByRole("dialog", { name: "Poprosić o dostęp?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Wyślij" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Nie udało się wysłać prośby");
    expect(within(dialog).getByRole("button", { name: "Wyślij" })).toBeEnabled();
    expect(groupsApi.getGroupAccess).toHaveBeenCalledTimes(1);
  });

  it("pending: returning to the tab refetches and an approval shows the term content", async () => {
    vi.mocked(groupsApi.getGroupAccess)
      .mockResolvedValueOnce(pendingAccess)
      .mockResolvedValueOnce(access({ access: { is_member: true } }));
    renderPage();
    await screen.findByRole("button", { name: "Sprawdź ponownie" });

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(await screen.findByText("Zajęcia w parku")).toBeInTheDocument();
    expect(groupsApi.getGroupAccess).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Ta grupa jest prywatna/)).not.toBeInTheDocument();
  });

  it("a failed fetch after a token change shows the retry line instead of a loader; a retry resolves it", async () => {
    mockAuth = { token: null, displayName: null };
    vi.mocked(groupsApi.getGroupAccess)
      .mockResolvedValueOnce(privateAccess())
      .mockRejectedValueOnce(new Error("500"))
      .mockResolvedValueOnce(pendingAccess);
    const view = renderPage();
    await screen.findByRole("link", { name: "Zaloguj się" });

    mockAuth = { token: "tok", displayName: "Ala" };
    view.rerender(page());

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się odświeżyć strony — spróbuj ponownie.");
    expect(screen.queryByText("Wczytywanie...")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Zaloguj się" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));

    expect(await within(screen.getByRole("status")).findByText(/Prośba wysłana/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("TermPage — view fixes", () => {
  it("logged in with no display name yet: sign-up opens the logged-in RSVP dialog, not the guest one", async () => {
    mockAuth = { token: "tok", displayName: null };
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "＋ Zapisz się na zajęcia" }));

    expect(screen.getByRole("dialog", { name: "Zapisz się na zajęcia" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Imię")).not.toBeInTheDocument();
  });

  it("logged in with no display name yet: hides 'Zapisujesz się jako' and blocks submit until the name loads", async () => {
    mockAuth = { token: "tok", displayName: null };
    vi.mocked(groupsApi.createRsvp).mockResolvedValue({} as never);
    const { rerender } = renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "＋ Zapisz się na zajęcia" }));
    const dialog = screen.getByRole("dialog", { name: "Zapisz się na zajęcia" });
    expect(within(dialog).queryByText(/Zapisujesz się jako/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Zapisz się" })).toBeDisabled();

    mockAuth = { token: "tok", displayName: "Ala" };
    rerender(page());
    const submit = within(screen.getByRole("dialog", { name: "Zapisz się na zajęcia" })).getByRole("button", {
      name: "Zapisz się",
    });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => expect(groupsApi.createRsvp).toHaveBeenCalledTimes(1));
    const [, body] = vi.mocked(groupsApi.createRsvp).mock.calls[0];
    expect(body.guardian_name).toBe("Ala");
  });

  it("logged in with a display name: the RSVP dialog names the user", async () => {
    mockAuth = { token: "tok", displayName: "Ala" };
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "＋ Zapisz się na zajęcia" }));

    const dialog = screen.getByRole("dialog", { name: "Zapisz się na zajęcia" });
    expect(within(dialog).getByText(/Zapisujesz się jako/)).toHaveTextContent("Zapisujesz się jako Ala");
  });

  it("a PRIVATE group member sees the full term view with no guest or gate actions", async () => {
    mockAuth = { token: "tok", displayName: "Ala" };
    vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(
      access({ group: { visibility: "PRIVATE" }, access: { is_member: true } }),
    );
    renderPage();

    expect(await screen.findByText("Zajęcia w parku")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Zapisani na zajęcia" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "＋ Zapisz się na zajęcia" })).toBeInTheDocument();
    expect(screen.queryByText(/Ta grupa jest prywatna/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Poproś o dostęp" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Zaloguj się, żeby się zapisać" })).not.toBeInTheDocument();
  });

  it("the needed-items and attendee sections are named regions", async () => {
    renderPage();

    const needed = await screen.findByRole("region", { name: "Potrzebne rzeczy" });
    expect(within(needed).getByText("Bębenek")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Zapisani na zajęcia" })).toBeInTheDocument();
  });
});
