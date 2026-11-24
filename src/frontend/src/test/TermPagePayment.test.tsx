import { fireEvent, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as familiesApi from "../api/families";
import type { PaymentStatus, PublicCircleResponse, PublicTermResponse } from "../api/groups";
import { TermNeededItems } from "../features/terms/blocks/TermNeededItems";
import { TermSignUp } from "../features/terms/blocks/TermSignUp";
import { TermCard } from "../features/terms/components/TermCard";
import { SavedTermCard } from "../features/meetings/TermCards";
import { RsvpDialogLoggedIn } from "../features/terms/modals/RsvpDialogLoggedIn";
import { TermPageContext, type TermPageValue } from "../features/terms/TermPageContext";
import { formatPrice, type GuestTermCard } from "../utils/appHelpers";
import { renderWithRoute } from "./renderWithRoute";

vi.mock("../api/families", () => ({ getMyFamilies: vi.fn() }));
vi.mock("../api/groups", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/groups")>()),
  createRsvp: vi.fn(),
}));

// Queries normalize the DOM's no-break space, not the expected string.
const PRICE = formatPrice("25.50").replace(/\s/g, " ");
const PAY_URL = "https://pay.example.com/abc";

const term: PublicTermResponse = {
  id: "1c2d3e4f-5a6b-4c7d-8e9f-0000000000c1",
  occurs_on: "2026-12-05T10:00:00",
  description: null,
  location: null,
  capacity: null,
  attendee_count: 0,
  needed_items: [],
  item_listings: [],
  price: "25.50",
  payment_url: null,
  payment_method: null,
};

const group: PublicCircleResponse = {
  id: "5f0c2a7e-3b1d-4e6a-9c8f-0000000000a5",
  name: "Sobotnia zamiana ubranek",
  organizer_display_name: "Ania Kowalska",
  organizer_slug: "ania",
  organizer_party_id: "5f0c2a7e-3b1d-4e6a-9c8f-0000000000e1",
  visibility: "PUBLIC",
  layout_mode: "CIRCLE",
  organization: null,
  term,
  guardians: [],
};

function renderSignUp({
  baseTerm = term,
  termOverrides = {},
  isAttending,
  paymentStatus,
  block = <TermSignUp />,
}: {
  baseTerm?: PublicTermResponse;
  termOverrides?: Partial<PublicTermResponse>;
  isAttending: boolean;
  paymentStatus: PaymentStatus | null;
  block?: ReactElement;
}) {
  const value: TermPageValue = {
    view: {
      kind: "content",
      group: { ...group, term: { ...baseTerm, ...termOverrides } },
      isAttending,
      isOrganizer: false,
      isMember: false,
      isActiveAttendee: isAttending,
      paymentStatus,
    },
    isLoggedIn: true,
    displayName: "Ola Nowak",
    refetch: async () => {},
    showToast: () => {},
    activePartyId: null,
    selectAttendee: () => {},
  };
  return renderWithRoute(
    <TermPageContext.Provider value={value}>{block}</TermPageContext.Provider>,
    { url: "/ania/group/g/term/t" },
  );
}

function card(overrides: Partial<GuestTermCard>): GuestTermCard {
  return {
    termId: "t1",
    attendanceId: null,
    occursOn: "2026-12-06T10:00:00",
    groupName: "Sobotnia zamiana ubranek",
    description: null,
    href: "/ania/group/g/term/t1",
    location: null,
    capacity: null,
    attendeeCount: null,
    price: null,
    paymentStatus: null,
    ...overrides,
  };
}

/** A copy without `keys` at runtime, still typed as `T`: simulates a response
 * from a backend older than the paid-terms fields without an `as` cast. */
function withoutFields<T extends object>(value: T, keys: (keyof T)[]): T {
  const copy = { ...value };
  for (const key of keys) Reflect.deleteProperty(copy, key);
  return copy;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([]);
});

describe("TermPage — price before signing up", () => {
  it("shows the price badge before the points badge, with the online line or 'płatność na miejscu'", () => {
    const { rerender } = renderWithRoute(
      <TermCard date={term.occurs_on} capacity={null} attendancePoints={20} price="25.50" paymentUrl={PAY_URL} />,
      { url: "/" },
    );
    const card = screen.getByRole("region", { name: "Termin zajęć" });
    const badge = within(card).getByText(PRICE);
    expect(badge.compareDocumentPosition(within(card).getByText("+20 pkt za obecność"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(within(card).getByText("Płatność online po zapisaniu się.")).toBeInTheDocument();
    expect(within(card).queryByText("płatność na miejscu")).not.toBeInTheDocument();

    rerender(<TermCard date={term.occurs_on} capacity={null} price="25.50" paymentUrl={null} />);
    expect(screen.getByText(PRICE)).toBeInTheDocument();
    expect(screen.getByText("płatność na miejscu")).toBeInTheDocument();
    expect(screen.queryByText("Płatność online po zapisaniu się.")).not.toBeInTheDocument();
  });

  it("shows no price badge or payment line for a free term", () => {
    renderWithRoute(<TermCard date={term.occurs_on} capacity={null} price={null} paymentUrl={null} />, { url: "/" });
    expect(screen.queryByText(/zł/)).not.toBeInTheDocument();
    expect(screen.queryByText(/płatność/i)).not.toBeInTheDocument();
  });

  it("shows the cost line in the sign-up dialog, by payment variant", async () => {
    const props = { groupId: "g", termId: "t", displayName: "Ola", onClose: () => {}, onSubmitted: () => {} };
    const { rerender } = renderWithRoute(<RsvpDialogLoggedIn {...props} price="25.50" paymentUrl={PAY_URL} />, {
      url: "/",
    });
    expect(await screen.findByText(`Koszt: ${PRICE} — zapłacisz po zapisaniu`)).toBeInTheDocument();

    rerender(<RsvpDialogLoggedIn {...props} price="25.50" paymentUrl={null} />);
    expect(screen.getByText(`Koszt: ${PRICE} — płatność na miejscu`)).toBeInTheDocument();

    rerender(<RsvpDialogLoggedIn {...props} price={null} paymentUrl={null} />);
    expect(screen.queryByText(/Koszt:/)).not.toBeInTheDocument();
  });

  it("shows the cost line in the dialog opened from the needed-items sign-up prompt", async () => {
    renderSignUp({
      termOverrides: {
        payment_url: PAY_URL,
        needed_items: [
          { id: "n1", name: "Kredki", description: null, claimed: false, claimed_by_name: null, claimed_by_party_id: null },
        ],
      },
      isAttending: false,
      paymentStatus: null,
      block: <TermNeededItems />,
    });
    fireEvent.click(screen.getByRole("button", { name: "Ja to przyniosę: Kredki" }));
    fireEvent.click(screen.getByRole("button", { name: "Zapisz się na zajęcia" }));

    const dialog = await screen.findByRole("dialog", { name: "Zapisz się na zajęcia" });
    expect(within(dialog).getByText(`Koszt: ${PRICE} — zapłacisz po zapisaniu`)).toBeInTheDocument();
  });
});

describe("TermPage — attendee footer", () => {
  it("renders no footer for an attendee of a free unpaid term, else their payment state", () => {
    const free = renderSignUp({ termOverrides: { price: null }, isAttending: true, paymentStatus: "UNPAID" });
    expect(free.container.querySelector("footer")).toBeNull();
    expect(screen.queryByRole("button", { name: "＋ Zapisz się" })).not.toBeInTheDocument();
    free.unmount();

    const priced = renderSignUp({ isAttending: true, paymentStatus: "UNPAID" });
    expect(screen.getByText(`Do zapłaty: ${PRICE} (na miejscu)`)).toBeInTheDocument();
    priced.unmount();

    renderSignUp({ termOverrides: { price: null }, isAttending: true, paymentStatus: "PAID" });
    expect(screen.getByText("Opłacone")).toBeInTheDocument();
  });

  it("treats a term from an older backend (no price/payment fields) as free", () => {
    const legacy = withoutFields(term, ["price", "payment_url", "payment_method"]);
    const attendee = renderSignUp({ baseTerm: legacy, isAttending: true, paymentStatus: null });
    expect(attendee.container).not.toHaveTextContent(/NaN|zł|Do zapłaty|Zapłać/);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    attendee.unmount();

    const guest = renderSignUp({ baseTerm: legacy, isAttending: false, paymentStatus: null });
    expect(screen.getByRole("button", { name: "＋ Zapisz się" })).toBeInTheDocument();
    expect(guest.container).not.toHaveTextContent(/NaN|zł|Koszt/);
  });

  it("renders the sign-up footer again for a withdrawn viewer", () => {
    renderSignUp({ isAttending: false, paymentStatus: "PAID" });
    expect(screen.getByRole("button", { name: "＋ Zapisz się" })).toBeInTheDocument();
    expect(screen.queryByText(/Opłacone/)).not.toBeInTheDocument();
  });
});

describe("Moje zajęcia — SavedTermCard payment badge", () => {
  it("shows '✓ Opłacone' when PAID and 'Do zapłaty X' when UNPAID with a price, never a pay link", () => {
    const props = { neededItems: [], pledges: [], onWithdrawPledge: () => {} };
    const { rerender } = renderWithRoute(
      <SavedTermCard {...props} card={card({ price: "25.50", paymentStatus: "PAID" })} />,
      { url: "/" },
    );
    expect(screen.getByText("Opłacone")).toBeInTheDocument();
    expect(screen.queryByText(/Do zapłaty/)).not.toBeInTheDocument();

    rerender(<SavedTermCard {...props} card={card({ price: "25.50", paymentStatus: "UNPAID" })} />);
    expect(screen.getByText(`Do zapłaty ${PRICE}`)).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);

    rerender(<SavedTermCard {...props} card={card({ price: "25.50", paymentStatus: null })} />);
    expect(screen.queryByText(/Do zapłaty|Opłacone/)).not.toBeInTheDocument();
  });

  it("treats a card from an older backend (no price/payment fields) as free", () => {
    const legacy = withoutFields(card({}), ["price", "paymentStatus"]);
    const { container } = renderWithRoute(
      <SavedTermCard neededItems={[]} pledges={[]} onWithdrawPledge={() => {}} card={legacy} />,
      { url: "/" },
    );
    expect(container).not.toHaveTextContent(/NaN|zł|Do zapłaty|Opłacone/);
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("shows no badge on a free term's UNPAID card", () => {
    renderWithRoute(
      <SavedTermCard neededItems={[]} pledges={[]} onWithdrawPledge={() => {}} card={card({ price: null, paymentStatus: "UNPAID" })} />,
      { url: "/" },
    );
    expect(screen.queryByText(/Do zapłaty|Opłacone/)).not.toBeInTheDocument();
  });
});
